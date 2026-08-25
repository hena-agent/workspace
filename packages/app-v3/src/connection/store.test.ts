import { describe, expect, test } from "bun:test"
import { createTransaction } from "@tanstack/db"
import { createConnectionStore } from "./store"

describe("connection store", () => {
  test("does not mark a collection ready before its authoritative snapshot", () => {
    const store = createConnectionStore()
    store.collection("projects")
    expect(store.isReady("projects")).toBe(false)
    store.applySnapshot("projects", "", [], 0)
    expect(store.isReady("projects")).toBe(true)
  })

  test("publishes a replacement snapshot atomically", () => {
    const store = createConnectionStore()
    store.applySnapshot("projects", "", [
      { key: "one", row: { id: "one" }, revision: "1" },
      { key: "two", row: { id: "two" }, revision: "1" },
    ], 4)
    store.applySnapshot("projects", "", [{ key: "two", row: { id: "two", name: "new" }, revision: "2" }], 8)

    expect(store.rows("projects", "")).toEqual([{ id: "two", name: "new" }])
    expect(store.cursor("projects", "")).toBe(8)
  })

  test("applies rows and resolves a waiter only after publication", async () => {
    const store = createConnectionStore()
    const waiter = store.awaitTxid("tx-1")
    let resolved = false
    void waiter.then(() => { resolved = true })

    store.applyRows({
      throughSeq: 9,
      changes: [{
        seq: 9,
        collection: "sessions",
        scopeKey: "",
        rowKey: "session-1",
        op: "insert",
        row: { id: "session-1", title: "Hello" },
        txid: "tx-1",
      }],
    })
    await waiter

    expect(resolved).toBe(true)
    expect(store.rows("sessions", "")).toEqual([{ id: "session-1", title: "Hello" }])
  })

  test("tracks UTF-8 delta offsets and exposes gaps", () => {
    const store = createConnectionStore()
    const identity = { sessionId: "s", messageId: "m", partId: "p", partKind: "text" as const }
    store.applyDelta({ ...identity, offset: 0, text: "é" })
    store.applyDelta({ ...identity, offset: 2, text: "!" })
    store.applyDelta({ ...identity, offset: 5, text: "gap" })

    expect(store.delta(identity)).toEqual({ text: "é!", incomplete: true })
  })

  test("coalesces delta notifications and clears finalized parts", () => {
    const frames: Array<() => void> = []
    const store = createConnectionStore({ scheduleFrame: (callback) => frames.push(callback) })
    const identity = { sessionId: "s", messageId: "m", partId: "p", partKind: "text" as const }
    let notifications = 0
    store.subscribeDelta(identity, () => notifications++)
    store.applyDelta({ ...identity, offset: 0, text: "one" })
    store.applyDelta({ ...identity, offset: 3, text: "two" })
    expect(notifications).toBe(0)
    frames[0]!()
    expect(notifications).toBe(1)

    store.applyRows({
      throughSeq: 1,
      changes: [{ seq: 1, collection: "parts", scopeKey: "s", rowKey: ["m", "text", "p"], op: "insert", row: { type: "text", text: "onetwo" } }],
    })
    expect(store.delta(identity)).toBeUndefined()
  })

  test("resolves timed-out receipts after requesting a scoped resnapshot", async () => {
    const resets: unknown[] = []
    const store = createConnectionStore({ onTxidTimeout: (scopes) => resets.push(scopes) })
    const scopes = [{ collection: "sessions", scopeKey: "" }]
    await store.awaitTxid("missing", 1, scopes)
    expect(resets).toEqual([scopes])
  })

  test("keeps authoritative rows separate from optimistic overlays", async () => {
    const store = createConnectionStore()
    store.applySnapshot("permissions", "", [{ key: "permission", row: { id: "permission" } }], 0)
    let persist = () => {}
    const transaction = createTransaction({ mutationFn: () => new Promise<void>((resolve) => { persist = resolve }) })
    transaction.mutate(() => store.collection("permissions").delete("permission"))
    expect(store.rows("permissions")).toEqual([])
    expect(store.authoritativeRows("permissions")).toEqual([{ id: "permission" }])

    const settled = store.awaitAuthoritativeState({
      collection: "permissions",
      scopeKey: "",
      timeoutMs: 100,
      predicate: (rows) => rows.length === 0,
    })
    store.applySnapshot("permissions", "", [], 0)
    await settled
    persist()
    await transaction.isPersisted.promise
  })
})
