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

  test("keeps the retained watermark after compacting every change", () => {
    database = createTestDatabase().database
    database.collections.write({ collection: "messages", scopeKey: "session-1", rowKey: "one", row: {}, revision: "1" })

    const floor = database.compact({ now: Date.now(), changeMaxAgeMs: Number.MAX_SAFE_INTEGER, changeMaxRows: 0 })

    expect(database.changes.current()).toBe(floor)
    expect(database.collections.snapshot("messages", "session-1").throughSeq).toBe(floor)
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
    const unsubscribe = database.changes.subscribe("messages", "ses_1", (changes) =>
      received.push(...changes.map((change) => change.rowKey)),
    )
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

  test("publishes one callback for all scoped rows in a transaction", () => {
    database = createTestDatabase().database
    const received = new Array<readonly string[]>()
    database.changes.subscribe("messages", "ses_1", (changes) => received.push(changes.map((change) => change.rowKey)))

    database.collections.replace(
      "messages",
      "ses_1",
      [
        { key: "msg_1", row: { id: "msg_1" }, revision: "1" },
        { key: "msg_2", row: { id: "msg_2" }, revision: "1" },
      ],
      "tx-1",
    )

    expect(received).toEqual([["msg_1", "msg_2"]])
  })

  test("publishes bounded resets for oversized transactions", () => {
    database = createTestDatabase().database
    const received = new Array<readonly string[]>()
    database.changes.subscribe("messages", "ses_1", (changes) =>
      received.push(changes.map((change) => change.op)),
    )

    database.collections.replace(
      "messages",
      "ses_1",
      Array.from({ length: 5 }, (_, index) => ({
        key: `msg_${index}`,
        row: { id: `msg_${index}`, text: "x".repeat(900 * 1024) },
        revision: "1",
      })),
      "tx-large",
    )

    expect(received).toEqual([["reset"]])
  })

  test("keeps noncontiguous reused transaction IDs separate", () => {
    database = createTestDatabase().database
    const received = new Array<readonly string[]>()
    database.changes.subscribeTransactions((changes) => received.push(changes.map((change) => change.rowKey)))

    database.changes.batch(() => {
      database!.changes.append({ collection: "messages", scopeKey: "ses_1", rowKey: "one", op: "insert", txid: "x" })
      database!.changes.append({ collection: "messages", scopeKey: "ses_1", rowKey: "two", op: "insert", txid: "y" })
      database!.changes.append({ collection: "messages", scopeKey: "ses_1", rowKey: "three", op: "insert", txid: "x" })
    })

    expect(received).toEqual([["one"], ["two"], ["three"]])
  })

  test("rejects rows that cannot fit in one snapshot frame before writing the changelog", () => {
    database = createTestDatabase().database

    expect(() =>
      database!.collections.write({
        collection: "messages",
        scopeKey: "ses_1",
        rowKey: "msg_1",
        row: { text: "x".repeat(1024 * 1024 - 16 * 1024) },
        revision: "1",
      }),
    ).toThrow("exceeds stream frame limit")
    expect(database.changes.current()).toBe(0)
  })
})
