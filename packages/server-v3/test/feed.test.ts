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

  test("replaces feed identity when startup hydration finds changes", () => {
    database = createTestDatabase().database
    const first = database.feed.get()
    database.collections.write({ collection: "sessions", scopeKey: "", rowKey: "ses_1", row: {}, revision: "1" })

    const feedId = database.feed.replace()

    expect(feedId).not.toBe(first.feedId)
    expect(database.feed.get()).toMatchObject({ feedId, retainedFloor: 0 })
    expect(database.changes.current()).toBe(0)
  })
})
