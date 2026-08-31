import { describe, expect, test } from "bun:test"
import { createLocalMessages } from "./local-messages"
import { createConnectionStore } from "./store"

describe("local messages", () => {
  test("reconciles prompts with authoritative input outcomes", () => {
    const store = createConnectionStore()
    const local = createLocalMessages()
    const message = { id: "message-1", type: "user", text: "Prompt" }
    local.stage("session-1", "message-1", message)
    local.applyRows(store, {
      throughSeq: 1,
      changes: [{ seq: 1, collection: "sessionInputs", scopeKey: "session-1", rowKey: "message-1", op: "insert", row: { id: "message-1" } }],
    })
    expect(local.rows("session-1")).toEqual([message])

    local.applyRows(store, {
      throughSeq: 2,
      changes: [{ seq: 2, collection: "sessionInputs", scopeKey: "session-1", rowKey: "message-1", op: "delete", row: null }],
    })
    expect(local.rows("session-1")).toEqual([])

    local.stage("session-1", "message-2", { ...message, id: "message-2" })
    const promotion = [
      { seq: 3, collection: "sessionInputs", scopeKey: "session-1", rowKey: "message-2", op: "delete" as const, row: null, txid: "promote" },
      { seq: 3, collection: "messages", scopeKey: "session-1", rowKey: "message-2", op: "insert" as const, row: { ...message, id: "message-2" }, txid: "promote" },
    ]
    local.applyRows(store, {
      throughSeq: 3,
      changes: [promotion[0]!],
    }, promotion)
    expect(local.rows("session-1")).toHaveLength(1)
    local.applyRows(store, { throughSeq: 3, changes: [promotion[1]!] }, promotion)
    local.applySnapshot(store, "messages", "session-1", [{ key: "message-2", row: { ...message, id: "message-2" } }], 3)
    local.applySnapshot(store, "parts", "session-1", [], 3)
    expect(local.rows("session-1")).toEqual([])
    expect(store.rows("messages", "session-1")).toEqual([{ ...message, id: "message-2" }])
  })
})
