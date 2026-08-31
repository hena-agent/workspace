import { describe, expect, test } from "bun:test"
import { createTransaction } from "@tanstack/db"
import { createConnectionStore } from "./store"

describe("connection store", () => {
  test("batches canonical snapshot notifications", () => {
    const store = createConnectionStore()
    const observed: string[][] = []
    store.subscribe(() => observed.push(store.rows("messages", "session-1").map((row) => String(row.id))))

    store.batch(() => {
      store.applySnapshot("messages", "session-1", [{ key: "message-1", row: { id: "message-1" } }], 1)
      store.applySnapshot("parts", "session-1", [], 1)
    })

    expect(observed).toEqual([["message-1"]])
  })

  test("settles receipts for filtered recovery rows", async () => {
    const store = createConnectionStore()
    const settled = store.awaitTxid("txid", 100)
    store.settleReceipts([{ seq: 1, collection: "messages", scopeKey: "session-1", rowKey: "", op: "reset", row: null, txid: "txid" }])

    await settled
  })

  test("publishes final delta identities after a snapshot batch", () => {
    const store = createConnectionStore()
    const identity = { sessionId: "session-1", messageId: "message-1", partId: "part-1", partKind: "text" as const }
    store.applyDelta({ ...identity, offset: 0, text: "streaming" })
    const observed: string[][] = []
    store.subscribeDeltaIdentities("session-1", () => observed.push(store.deltaIdentities("session-1").map((item) => item.partId)))

    store.batch(() => store.applySnapshot("parts", "session-1", [], 1))

    expect(observed).toEqual([[]])
    expect(store.delta(identity)).toBeUndefined()
  })

  test("does not mark a collection ready before its authoritative snapshot", () => {
    const store = createConnectionStore()
    store.collection("projects")
    expect(store.isReady("projects")).toBe(false)
    store.applySnapshot("projects", "", [], 0)
    expect(store.isReady("projects")).toBe(true)
  })

  test("marks a collection unready when its scope resets", () => {
    const store = createConnectionStore()
    store.applySnapshot("messages", "session-1", [], 1)

    store.applyRows({
      throughSeq: 2,
      changes: [{ seq: 2, collection: "messages", scopeKey: "session-1", rowKey: [], op: "reset", row: null }],
    })

    expect(store.isReady("messages", "session-1")).toBe(false)
    expect(store.cursor("messages", "session-1")).toBe(0)
    store.applySnapshot("messages", "session-1", [], 2)
    expect(store.isReady("messages", "session-1")).toBe(true)
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

  test("authoritative text rows clear incomplete live text", () => {
    const store = createConnectionStore()
    const updated = { sessionId: "s", messageId: "m", partId: "updated", partKind: "text" as const }
    const replaced = { sessionId: "s", messageId: "m", partId: "replaced", partKind: "text" as const }
    store.applyDelta({ ...updated, offset: 0, text: "stale" })
    store.applyDelta({ ...updated, offset: 10, text: "gap" })
    store.applyDelta({ ...replaced, offset: 0, text: "stale" })
    store.applyDelta({ ...replaced, offset: 10, text: "gap" })

    store.applyRows({
      throughSeq: 1,
      changes: [{ seq: 1, collection: "parts", scopeKey: "s", rowKey: ["m", "text", "updated"], op: "update", row: { type: "text", text: "durable update" } }],
    })
    expect(store.delta(updated)).toBeUndefined()
    expect(store.rows("parts", "s")).toEqual([{ type: "text", text: "durable update" }])

    store.applySnapshot("parts", "s", [{
      key: ["m", "text", "replaced"],
      row: { type: "text", text: "durable snapshot" },
    }], 2)

    expect(store.delta(replaced)).toBeUndefined()
    expect(store.rows("parts", "s")).toEqual([{ type: "text", text: "durable snapshot" }])
  })

  test("bounds live delta previews by bytes and lines", () => {
    const store = createConnectionStore()
    const bytes = { sessionId: "s", messageId: "m", partId: "bytes", partKind: "text" as const }
    const lines = { sessionId: "s", messageId: "m", partId: "lines", partKind: "text" as const }
    const byteText = "😀".repeat(9_000)
    const lineText = `${"line\n".repeat(500)}hidden`

    store.applyDelta({ ...bytes, offset: 0, text: byteText })
    store.applyDelta({ ...bytes, offset: new TextEncoder().encode(byteText).byteLength, text: "hidden" })
    store.applyDelta({ ...lines, offset: 0, text: lineText })

    expect(new TextEncoder().encode(store.delta(bytes)!.text).byteLength).toBeLessThanOrEqual(32 * 1024)
    expect(store.delta(bytes)!.text).not.toContain("�")
    expect(store.delta(bytes)!.text).not.toContain("hidden")
    expect(store.delta(lines)!.text.split("\n")).toHaveLength(500)
    expect(store.delta(lines)!.text).not.toContain("hidden")
  })

  test("coalesces delta notifications and keeps text deltas until the assistant completes", () => {
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
      changes: [{ seq: 1, collection: "parts", scopeKey: "s", rowKey: ["m", "text", "p"], op: "insert", row: { type: "text", text: "one" } }],
    })
    expect(store.delta(identity)).toEqual({ text: "onetwo", incomplete: false })

    store.applyRows({
      throughSeq: 2,
      changes: [{ seq: 2, collection: "messages", scopeKey: "s", rowKey: "m", op: "update", row: { id: "m", type: "assistant", time: { created: 1, completed: 2 } } }],
    })
    expect(store.delta(identity)).toBeUndefined()
  })

  test("notifies delta identity subscribers only when parts are added or removed", () => {
    const store = createConnectionStore()
    const identity = { sessionId: "s", messageId: "m", partId: "p", partKind: "text" as const }
    let notifications = 0
    store.subscribeDeltaIdentities("s", () => notifications++)

    store.applyDelta({ ...identity, offset: 0, text: "one" })
    store.applyDelta({ ...identity, offset: 3, text: "two" })
    expect(notifications).toBe(1)

    store.applyRows({
      throughSeq: 1,
      changes: [{ seq: 1, collection: "messages", scopeKey: "s", rowKey: "m", op: "delete", row: null }],
    })
    expect(notifications).toBe(2)
    expect(store.delta(identity)).toBeUndefined()
  })

  test("clears deltas omitted by replacement message snapshots", () => {
    const store = createConnectionStore()
    const kept = { sessionId: "s", messageId: "kept", partId: "p1", partKind: "text" as const }
    const removed = { sessionId: "s", messageId: "removed", partId: "p2", partKind: "reasoning" as const }
    store.applyDelta({ ...kept, offset: 0, text: "kept" })
    store.applyDelta({ ...removed, offset: 0, text: "removed" })

    store.applySnapshot("messages", "s", [{
      key: "kept",
      row: { id: "kept", type: "assistant", time: { created: 1 } },
    }], 1)

    expect(store.delta(kept)).toEqual({ text: "kept", incomplete: false })
    expect(store.delta(removed)).toBeUndefined()
  })

  test("keeps reasoning deltas until the reasoning part completes", () => {
    const store = createConnectionStore()
    const identity = { sessionId: "s", messageId: "m", partId: "p", partKind: "reasoning" as const }
    store.applyDelta({ ...identity, offset: 0, text: "live reasoning" })

    store.applyRows({
      throughSeq: 1,
      changes: [{ seq: 1, collection: "parts", scopeKey: "s", rowKey: ["m", "reasoning", "p"], op: "insert", row: { type: "reasoning", text: "", time: { created: 1 } } }],
    })
    expect(store.delta(identity)).toEqual({ text: "live reasoning", incomplete: false })

    store.applySnapshot("parts", "s", [{
      key: ["m", "reasoning", "p"],
      row: { type: "reasoning", text: "live reasoning", time: { created: 1, completed: 2 } },
    }], 2)
    expect(store.delta(identity)).toBeUndefined()
  })

  test("clears omitted deltas on replacement part snapshots and resets", () => {
    const store = createConnectionStore()
    const kept = { sessionId: "s", messageId: "m", partId: "kept", partKind: "text" as const }
    const removed = { sessionId: "s", messageId: "m", partId: "removed", partKind: "reasoning" as const }
    store.applyDelta({ ...kept, offset: 0, text: "kept" })
    store.applyDelta({ ...removed, offset: 0, text: "removed" })

    store.applySnapshot("parts", "s", [{
      key: ["m", "text", "kept"],
      row: { type: "text", text: "" },
    }], 1)
    expect(store.delta(kept)).toEqual({ text: "kept", incomplete: false })
    expect(store.delta(removed)).toBeUndefined()

    store.applyRows({
      throughSeq: 2,
      changes: [{ seq: 2, collection: "parts", scopeKey: "s", rowKey: [], op: "reset", row: null }],
    })
    expect(store.delta(kept)).toBeUndefined()
  })

  test("clears a stale text delta once a replacement snapshot supersedes it", () => {
    const store = createConnectionStore()
    const identity = { sessionId: "s", messageId: "m", partId: "p", partKind: "text" as const }
    store.applyDelta({ ...identity, offset: 0, text: "old" })

    store.applySnapshot("parts", "s", [{
      key: ["m", "text", "p"],
      row: { type: "text", text: "new authoritative text" },
    }], 1)

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
