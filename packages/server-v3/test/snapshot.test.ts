import { afterEach, describe, expect, test } from "bun:test"
import { createTestDatabase } from "./fixture"
import type { SyncDatabase } from "../src/storage/database"

describe("snapshots", () => {
  let database: SyncDatabase | undefined

  afterEach(() => database?.close())

  test("updates materialized rows and changelog atomically", () => {
    database = createTestDatabase().database
    const change = database.collections.write({
      collection: "messages",
      scopeKey: "session-1",
      rowKey: "message-1",
      row: { id: "message-1", text: "hello" },
      revision: "1",
      txid: "tx-1",
    })

    expect(database.collections.snapshot("messages", "session-1")).toEqual({
      rows: [{ key: "message-1", row: { id: "message-1", text: "hello" }, revision: "1" }],
      throughSeq: change.seq,
    })
    expect(database.changes.after("messages", "session-1", 0)).toHaveLength(1)
  })

  test("deletes a row with its change", () => {
    database = createTestDatabase().database
    database.collections.write({ collection: "messages", scopeKey: "session-1", rowKey: "message-1", row: { id: "message-1" }, revision: "1" })
    database.collections.delete("messages", "session-1", "message-1", "tx-2")

    expect(database.collections.snapshot("messages", "session-1").rows).toEqual([])
    expect(database.changes.after("messages", "session-1", 0).at(-1)).toMatchObject({ op: "delete", rowKey: "message-1", txid: "tx-2" })
  })
})
