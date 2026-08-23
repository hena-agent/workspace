import { afterEach, describe, expect, test } from "bun:test"
import { IdempotencyConflict } from "../src/storage/idempotency"
import { createTestDatabase } from "./fixture"
import type { SyncDatabase } from "../src/storage/database"

describe("idempotency ledger", () => {
  let database: SyncDatabase | undefined

  afterEach(() => database?.close())

  test("returns the recorded response for an exact retry", async () => {
    database = createTestDatabase().database
    let calls = 0

    const first = await database.idempotency.run({ principal: "local", operation: "settings.replace", key: "key-1", payload: { value: 1, scope: "profile" } }, () => {
      calls++
      return { txid: "tx-1", value: 1 }
    })
    const retry = await database.idempotency.run({ principal: "local", operation: "settings.replace", key: "key-1", payload: { scope: "profile", value: 1 } }, () => {
      calls++
      return { txid: "tx-2", value: 2 }
    })

    expect(first.outcome).toBe("applied")
    expect(retry).toEqual({ outcome: "exact_retry", response: { txid: "tx-1", value: 1 } })
    expect(calls).toBe(1)
  })

  test("rejects key reuse with a different payload", async () => {
    database = createTestDatabase().database
    await database.idempotency.run({ principal: "local", operation: "settings.replace", key: "key-1", payload: { value: 1 } }, () => ({ ok: true }))

    expect(() => database!.idempotency.run({ principal: "local", operation: "settings.replace", key: "key-1", payload: { value: 2 } }, () => ({ ok: true }))).toThrow(IdempotencyConflict)
  })

  test("rolls back domain and changelog writes when execution fails", () => {
    database = createTestDatabase().database

    expect(() => database!.idempotency.run(
      { principal: "local", operation: "test", key: "key-1", payload: {} },
      () => {
        database!.collections.write({ collection: "settings", scopeKey: "", rowKey: "theme", row: { value: "dark" }, revision: "1" })
        throw new Error("crash")
      },
    )).toThrow("crash")
    expect(database.collections.snapshot("settings", "").rows).toEqual([])
    expect(database.changes.after("settings", "", 0)).toEqual([])
  })

})
