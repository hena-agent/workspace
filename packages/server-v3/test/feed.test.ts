import { afterEach, describe, expect, test } from "bun:test"
import { createTestDatabase } from "./fixture"
import type { SyncDatabase } from "../src/storage/database"

describe("feed", () => {
  let database: SyncDatabase | undefined

  afterEach(() => database?.close())

  test("keeps feed identity across process runtimes", () => {
    const fixture = createTestDatabase()
    database = fixture.database
    const first = database.feed.get()
    database.close()

    database = fixture.reopen()
    const second = database.feed.get()

    expect(second.feedId).toBe(first.feedId)
    expect(second.runtimeId).not.toBe(first.runtimeId)
    expect(second.retainedFloor).toBe(0)
  })

  test("replaces feed identity and invalidates old idempotency receipts", () => {
    database = createTestDatabase().database
    const first = database.feed.get()
    database.collections.write({ collection: "sessions", scopeKey: "", rowKey: "ses_1", row: {}, revision: "1" })
    database.idempotency.run(
      { principal: "local", operation: "settings.replace", key: "key-1", payload: { value: 1 } },
      () => ({ value: "old" }),
    )

    const feedId = database.feed.replace()
    const retry = database.idempotency.run(
      { principal: "local", operation: "settings.replace", key: "key-1", payload: { value: 1 } },
      () => ({ value: "new" }),
    )

    expect(feedId).not.toBe(first.feedId)
    expect(database.feed.get()).toMatchObject({ feedId, retainedFloor: 0 })
    expect(database.changes.current()).toBe(0)
    expect(retry).toEqual({ outcome: "applied", response: { value: "new" } })
  })

  test("configures a busy timeout for concurrent SQLite writers", () => {
    database = createTestDatabase().database

    expect(database.raw.query<{ timeout: number }, []>("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 })
  })
})
