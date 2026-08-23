import { afterEach, describe, expect, test } from "bun:test"
import { createApp } from "../src/app"
import { assertNoPassword } from "../src/main"
import type { SyncDatabase } from "../src/storage/database"
import { createTestDatabase } from "./fixture"

describe("app", () => {
  let database: SyncDatabase | undefined

  afterEach(() => database?.close())

  test("reports capabilities without exposing data", async () => {
    database = createTestDatabase().database
    const response = await createApp({ database }).request("/api/collection/capabilities")

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({
      feedId: database.feed.get().feedId,
      protocol: { min: 1, max: 1 },
      auth: "none",
    })
  })

  test("refuses phase-one startup when a password is configured", () => {
    expect(() => assertNoPassword("secret")).toThrow("phase 2")
    expect(() => assertNoPassword("")).not.toThrow()
  })

  test("logs bounded request metadata without query values", async () => {
    database = createTestDatabase().database
    const records: unknown[] = []
    const response = await createApp({ database, logger: (record) => records.push(record) })
      .request("/api/collection/capabilities?secret=canary", { headers: { "x-correlation-id": "request-1" } })

    expect(response.headers.get("x-correlation-id")).toBe("request-1")
    expect(records).toEqual([{
      method: "GET",
      path: "/api/collection/capabilities",
      status: 200,
      durationMs: expect.any(Number),
      correlationId: "request-1",
    }])
    expect(JSON.stringify(records)).not.toContain("canary")
  })

  test("creates, subscribes, and deletes a stream", async () => {
    database = createTestDatabase().database
    const app = createApp({ database })
    const created = await app.request("/api/collection/streams", { method: "POST" })
    const stream = await created.json() as { streamId: string }

    expect(created.status).toBe(201)
    expect(stream.streamId).toHaveLength(22)

    const subscribed = await app.request(`/api/collection/streams/${stream.streamId}/subscription`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: 1, lists: true, sessions: ["session-1"], cursors: {} }),
    })
    expect(subscribed.status).toBe(200)
    expect(await subscribed.json()).toMatchObject({ revision: 1, generation: 0 })

    const removed = await app.request(`/api/collection/streams/${stream.streamId}`, { method: "DELETE" })
    expect(removed.status).toBe(204)
  })

  test("rejects malformed subscriptions", async () => {
    database = createTestDatabase().database
    const app = createApp({ database })
    const created = await app.request("/api/collection/streams", { method: "POST" })
    const stream = await created.json() as { streamId: string }
    const response = await app.request(`/api/collection/streams/${stream.streamId}/subscription`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: 0, lists: "yes", sessions: [], cursors: {} }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: "validation" } })
  })

  test("rejects control request bodies larger than 64 KiB", async () => {
    database = createTestDatabase().database
    const response = await createApp({ database }).request("/api/collection/streams/missing/subscription", {
      method: "PUT",
      headers: { "content-type": "application/json", "content-length": String(70 * 1024) },
      body: JSON.stringify({ value: "x".repeat(70 * 1024) }),
    })

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ error: { code: "payload_too_large" } })
  })

  test("allows base64 expansion before validating prompt attachments", async () => {
    database = createTestDatabase().database
    const response = await createApp({ database }).request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(21 * 1024 * 1024) },
      body: "{}",
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: "validation" } })
  })

  test("returns a typed revision conflict", async () => {
    database = createTestDatabase().database
    const app = createApp({ database })
    const created = await app.request("/api/collection/streams", { method: "POST" })
    const stream = await created.json() as { streamId: string }
    const request = () => app.request(`/api/collection/streams/${stream.streamId}/subscription`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: 1, lists: true, sessions: [], cursors: {} }),
    })

    await request()
    const response = await request()

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: { code: "subscription_revision_conflict", message: "Subscription revisions must increase" } })
  })

  test("does not attach a stream before it has a subscription", async () => {
    database = createTestDatabase().database
    const app = createApp({ database })
    const created = await app.request("/api/collection/streams", { method: "POST" })
    const stream = await created.json() as { streamId: string }

    const events = await app.request(`/api/collection/streams/${stream.streamId}/events`)
    const subscribed = await app.request(`/api/collection/streams/${stream.streamId}/subscription`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: 1, lists: false, sessions: [], cursors: {} }),
    })

    expect(events.status).toBe(409)
    expect(await subscribed.json()).toMatchObject({ generation: 0 })
  })
})
