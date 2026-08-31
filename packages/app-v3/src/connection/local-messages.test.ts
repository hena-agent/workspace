import { describe, expect, test } from "bun:test"
import { createLocalMessages } from "./local-messages"
import { createConnectionStore } from "./store"

describe("local messages", () => {
  test("reconciles prompts with authoritative input outcomes", () => {
    const store = createConnectionStore()
    const local = createLocalMessages()
    const message = { id: "message-1", type: "user", text: "Prompt" }
    local.stage("session-1", "message-1", message)
    store.applySnapshot("messages", "session-1", [], 1)
    store.applySnapshot("parts", "session-1", [], 1)
    store.applySnapshot("sessionInputs", "session-1", [{ key: "message-1", row: { id: "message-1" } }], 1)
    local.acknowledge(store, "session-1", "message-1")
    expect(local.rows("session-1")).toEqual([message])

    store.applyRows({
      throughSeq: 2,
      changes: [{ seq: 2, collection: "sessionInputs", scopeKey: "session-1", rowKey: "message-1", op: "delete", row: null }],
    })
    local.reconcile(store, "session-1")
    expect(local.rows("session-1")).toEqual([])

    local.stage("session-1", "message-2", { ...message, id: "message-2" })
    store.applyRows({
      throughSeq: 3,
      changes: [{ seq: 3, collection: "sessionInputs", scopeKey: "session-1", rowKey: "message-2", op: "insert", row: { id: "message-2" } }],
    })
    local.acknowledge(store, "session-1", "message-2")
    expect(local.rows("session-1")).toHaveLength(1)
    store.applySnapshot("messages", "session-1", [{ key: "message-2", row: { ...message, id: "message-2" } }], 3)
    local.reconcile(store, "session-1")
    expect(local.rows("session-1")).toEqual([])
    expect(store.rows("messages", "session-1")).toEqual([{ ...message, id: "message-2" }])
  })

  test("drops acknowledged prompts omitted by complete replacement snapshots", () => {
    const store = createConnectionStore()
    const local = createLocalMessages()
    local.stage("session-1", "message-1", { id: "message-1" })
    local.acknowledge(store, "session-1", "message-1")

    store.applySnapshot("messages", "session-1", [], 2)
    store.applySnapshot("parts", "session-1", [], 2)
    store.applySnapshot("sessionInputs", "session-1", [], 2)
    local.reconcile(store, "session-1")

    expect(local.rows("session-1")).toEqual([])
  })
})
