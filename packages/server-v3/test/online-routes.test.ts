import { afterEach, describe, expect, test } from "bun:test"
import { createApp } from "../src/app"
import { unavailableCoreDomain } from "../src/core/domain"
import { createTestDatabase } from "./fixture"
import type { SyncDatabase } from "../src/storage/database"

describe("online reply routes", () => {
  let database: SyncDatabase | undefined
  afterEach(() => database?.close())

  test("replies to a pending permission", async () => {
    database = createTestDatabase().database
    const calls: unknown[] = []
    const domain = {
      ...unavailableCoreDomain(),
      replyPermission: async (requestID: string, input: unknown) => {
        calls.push({ requestID, input })
        return { outcome: "applied" as const, resolution: { requestID, reply: "once" } }
      },
    }
    const response = await createApp({ database, domain }).request("/api/permission/per_1/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ location: { directory: "/repo" }, sessionID: "ses_1", nonce: "nonce", reply: "once" }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ outcome: "applied", resolution: { requestID: "per_1" } })
    expect(calls).toHaveLength(1)
  })

  test("returns an authoritative already-resolved question outcome", async () => {
    database = createTestDatabase().database
    const domain = {
      ...unavailableCoreDomain(),
      replyQuestion: async () => ({
        outcome: "already_resolved" as const,
        resolution: { requestID: "que_1", answers: [["A"]] },
      }),
    }
    const response = await createApp({ database, domain }).request("/api/question/que_1/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ location: { directory: "/repo" }, sessionID: "ses_1", nonce: "stale", answers: [["B"]] }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      outcome: "already_resolved",
      resolution: { requestID: "que_1", answers: [["A"]] },
    })
  })

  test("rejects malformed permission and question IDs", async () => {
    database = createTestDatabase().database
    const app = createApp({ database })
    const body = JSON.stringify({ location: { directory: "/repo" }, sessionID: "ses_1", nonce: "nonce", reply: "once" })
    const permission = await app.request("/api/permission/invalid/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    })
    const question = await app.request("/api/question/invalid/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ location: { directory: "/repo" }, sessionID: "ses_1", nonce: "nonce", answers: [] }),
    })

    expect(permission.status).toBe(400)
    expect(question.status).toBe(400)
  })
})
