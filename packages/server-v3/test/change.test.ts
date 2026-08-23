import { afterEach, describe, expect, test } from "bun:test"
import { createTestDatabase } from "./fixture"
import type { SyncDatabase } from "../src/storage/database"

describe("collection changes", () => {
  let database: SyncDatabase | undefined

  afterEach(() => database?.close())

  test("reads scoped changes in sequence order", () => {
    database = createTestDatabase().database
    database.changes.append({
      collection: "messages",
      scopeKey: "session-1",
      rowKey: "m2",
      op: "insert",
      row: { id: "m2" },
    })
    database.changes.append({
      collection: "messages",
      scopeKey: "session-2",
      rowKey: "m3",
      op: "insert",
      row: { id: "m3" },
    })
    database.changes.append({
      collection: "messages",
      scopeKey: "session-1",
      rowKey: "m1",
      op: "update",
      row: { id: "m1" },
    })

    const rows = database.changes.after("messages", "session-1", 0)

    expect(rows.map((row) => row.rowKey)).toEqual(["m2", "m1"])
    expect(rows[1]!.seq).toBeGreaterThan(rows[0]!.seq)
  })

  test("reset has an empty row key and no row", () => {
    database = createTestDatabase().database
    const reset = database.changes.reset("messages", "session-1")

    expect(reset).toMatchObject({ op: "reset", rowKey: "", row: null })
  })

  test("compacts old rows and advances the feed floor", () => {
    database = createTestDatabase().database
    database.changes.append({ collection: "messages", scopeKey: "session-1", rowKey: "one", op: "insert", row: {} })
    database.changes.append({ collection: "messages", scopeKey: "session-1", rowKey: "two", op: "insert", row: {} })

    const floor = database.compact({ now: Date.now(), changeMaxAgeMs: Number.MAX_SAFE_INTEGER, changeMaxRows: 1 })

    expect(floor).toBeGreaterThan(0)
    expect(database.feed.get().retainedFloor).toBe(floor)
    expect(database.changes.after("messages", "session-1", 0).map((row) => row.rowKey)).toEqual(["two"])
  })

  test("finds the latest projected transaction for a specific row", () => {
    database = createTestDatabase().database
    database.changes.append({
      collection: "sessions",
      scopeKey: "",
      rowKey: "ses_1",
      op: "update",
      row: {},
      txid: "target",
    })
    database.changes.append({
      collection: "sessions",
      scopeKey: "",
      rowKey: "ses_2",
      op: "update",
      row: {},
      txid: "other",
    })

    expect(database.changes.latest([{ collection: "sessions", scopeKey: "", rowKey: "ses_1" }])?.txid).toBe("target")
  })

  test("publishes changelog rows inserted by the core transaction", () => {
    database = createTestDatabase().database
    const received = new Array<string>()
    const unsubscribe = database.changes.subscribe("messages", "ses_1", (change) => received.push(change.rowKey))
    database.raw
      .query(
        `
      INSERT INTO collection_change
        (collection, scope_key, row_key, op, row, row_revision, txid, runtime_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        "messages",
        "ses_1",
        "msg_1",
        "insert",
        '{"id":"msg_1"}',
        "1",
        "tx-1",
        database.feed.get().runtimeId,
        Date.now(),
      )

    database.changes.publishPersisted()
    unsubscribe()

    expect(received).toEqual(["msg_1"])
  })

  test("rejects oversized rows before writing the changelog", () => {
    database = createTestDatabase().database

    expect(() =>
      database!.collections.write({
        collection: "messages",
        scopeKey: "ses_1",
        rowKey: "msg_1",
        row: { text: "x".repeat(1024 * 1024) },
        revision: "1",
      }),
    ).toThrow("exceeds 1 MiB")
    expect(database.changes.current()).toBe(0)
  })
})
