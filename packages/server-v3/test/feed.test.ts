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
})
