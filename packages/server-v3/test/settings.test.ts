import { afterEach, describe, expect, test } from "bun:test"
import { createApp } from "../src/app"
import type { SyncDatabase } from "../src/storage/database"
import { createTestDatabase } from "./fixture"

describe("settings mutation", () => {
  let database: SyncDatabase | undefined

  afterEach(() => database?.close())

  test("writes a revisioned row and returns its receipt", async () => {
    database = createTestDatabase().database
    const response = await replace(createApp({ database }), { idempotencyKey: "key-1", value: "dark" })
    const body = (await response.json()) as { revision: string; receipt: { through: { seq: number } } }

    expect(response.status).toBe(200)
    expect(database.settings.get("profile", "theme")).toEqual({ value: "dark", revision: body.revision })
    expect(body.receipt.through.seq).toBeGreaterThan(0)
    expect(database.changes.after("settings", "profile", 0)[0]?.op).toBe("insert")
  })

  test("replays the exact result without writing twice", async () => {
    database = createTestDatabase().database
    const app = createApp({ database })
    const first = (await (await replace(app, { idempotencyKey: "key-1", value: "dark" })).json()) as {
      revision: string
    }
    const retry = (await (await replace(app, { idempotencyKey: "key-1", value: "dark" })).json()) as {
      revision: string
      receipt: { outcome: string }
    }

    expect(retry.revision).toBe(first.revision)
    expect(retry.receipt.outcome).toBe("exact_retry")
    expect(database.changes.after("settings", "profile", 0)).toHaveLength(1)
  })

  test("rejects an idempotency key reused for a different setting target", async () => {
    database = createTestDatabase().database
    const app = createApp({ database })
    await replace(app, { idempotencyKey: "key-1", value: "dark" })
    const response = await app.request("/api/settings/workspace/theme", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "key-1", value: "dark" }),
    })

    expect(response.status).toBe(409)
    expect(database.settings.get("workspace", "theme")).toBeUndefined()
  })

  test("rejects a stale expected revision", async () => {
    database = createTestDatabase().database
    const app = createApp({ database })
    await replace(app, { idempotencyKey: "key-1", value: "dark" })
    const response = await replace(app, { idempotencyKey: "key-2", expectedRevision: "stale", value: "light" })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: "revision_conflict" } })
  })

  test("rejects setting values larger than 16 KiB", async () => {
    database = createTestDatabase().database
    const response = await createApp({ database }).request("/api/settings/profile/defaultModel", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: "large-setting",
        value: { id: "x".repeat(16 * 1024 + 1), providerID: "provider" },
      }),
    })

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ error: { code: "payload_too_large" } })
  })

  test("rejects secret and unknown settings before storage", async () => {
    database = createTestDatabase().database
    const response = await createApp({ database }).request("/api/settings/profile/apiKey", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "secret-setting", value: "secret-canary" }),
    })

    expect(response.status).toBe(400)
    expect(database.collections.snapshot("settings", "profile").rows).toEqual([])
    expect(database.changes.current()).toBe(0)
    expect(JSON.stringify(database.raw.query("SELECT * FROM idempotency_record").all())).not.toContain("secret-canary")
  })
})

function replace(app: ReturnType<typeof createApp>, body: Record<string, unknown>) {
  return app.request("/api/settings/profile/theme", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
