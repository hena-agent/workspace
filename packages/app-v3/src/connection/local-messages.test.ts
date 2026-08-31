import { describe, expect, test } from "bun:test"
import { createLocalMessages } from "./local-messages"
import { createConnectionStore } from "./store"

describe("local messages", () => {
  test("reconciles prompts with authoritative input outcomes", () => {
    const store = createConnectionStore()
    const local = createLocalMessages(store)
    const message = { id: "message-1", type: "user", text: "Prompt" }
    local.stage("session-1", "message-1", message)
    store.applySnapshot("messages", "session-1", [], 1)
    store.applySnapshot("parts", "session-1", [], 1)
    store.applySnapshot("sessionInputs", "session-1", [{ key: "message-1", row: { id: "message-1" } }], 1)
    local.acknowledge("session-1", "message-1")
    expect(local.rows("session-1")).toEqual([message])

    store.applyRows({
      throughSeq: 2,
      changes: [{ seq: 2, collection: "sessionInputs", scopeKey: "session-1", rowKey: "message-1", op: "delete", row: null }],
    })
    expect(local.rows("session-1")).toEqual([])

    local.stage("session-1", "message-2", { ...message, id: "message-2" })
    store.applyRows({
      throughSeq: 3,
      changes: [{ seq: 3, collection: "sessionInputs", scopeKey: "session-1", rowKey: "message-2", op: "insert", row: { id: "message-2" } }],
    })
    local.acknowledge("session-1", "message-2")
    expect(local.rows("session-1")).toHaveLength(1)
    store.applySnapshot("messages", "session-1", [{ key: "message-2", row: { ...message, id: "message-2" } }], 3)
    expect(local.rows("session-1")).toEqual([])
    expect(store.rows("messages", "session-1")).toEqual([{ ...message, id: "message-2" }])
  })

  test("drops acknowledged prompts omitted by complete replacement snapshots", () => {
    const store = createConnectionStore()
    const local = createLocalMessages(store)
    local.stage("session-1", "message-1", { id: "message-1" })
    local.acknowledge("session-1", "message-1")

    store.applySnapshot("messages", "session-1", [], 2)
    store.applySnapshot("parts", "session-1", [], 2)
    store.applySnapshot("sessionInputs", "session-1", [], 2)
    expect(local.rows("session-1")).toEqual([])
  })

  test("does not reconcile acknowledged prompts against preserved recovery rows", () => {
    const store = createConnectionStore()
    const local = createLocalMessages(store)
    store.applySnapshot("messages", "session-1", [], 1)
    store.applySnapshot("parts", "session-1", [], 1)
    store.applySnapshot("sessionInputs", "session-1", [{ key: "message-1", row: { id: "message-1" } }], 1)
    local.stage("session-1", "message-1", { id: "message-1" })
    local.acknowledge("session-1", "message-1")

    store.resetCursors([
      { collection: "messages", scopeKey: "session-1" },
      { collection: "parts", scopeKey: "session-1" },
    ])
    store.applySnapshot("sessionInputs", "session-1", [], 2)
    expect(local.rows("session-1")).toHaveLength(1)

    store.batch(() => {
      store.applySnapshot("messages", "session-1", [], 2)
      store.applySnapshot("parts", "session-1", [], 2)
    })
    expect(local.rows("session-1")).toEqual([])
  })
})
