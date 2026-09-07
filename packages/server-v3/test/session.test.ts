import { afterEach, describe, expect, test } from "bun:test"
import { createApp } from "../src/app"
import type { CoreDomain } from "../src/core/domain"
import type { SyncDatabase } from "../src/storage/database"
import { createTestDatabase } from "./fixture"
import { Session } from "@hena/schema/session"
import { SessionMessage } from "@hena/schema/session-message"

describe("session mutations", () => {
  let database: SyncDatabase | undefined

  afterEach(() => database?.close())

  test("creates a session and admits its first prompt", async () => {
    database = createTestDatabase().database
    const domain = recordingDomain()
    const sessionID = Session.ID.create()
    const messageID = SessionMessage.ID.create()
    const response = await createApp({ database, domain }).request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        sessionID,
        messageID,
        location: { directory: "/tmp/project" },
        prompt: { text: "hello" },
      }),
    })
    const body = await response.json() as { receipt: { affectedScopes: unknown[] } }

    expect(response.status).toBe(200)
    expect(domain.calls).toEqual([`create:${sessionID}:${messageID}`])
    expect(body.receipt.affectedScopes).toHaveLength(2)
  })

  test("passes expected revisions to cancel and reorder", async () => {
    database = createTestDatabase().database
    const domain = recordingDomain()
    const app = createApp({ database, domain })
    const sessionID = Session.ID.create()
    const first = SessionMessage.ID.create()
    const second = SessionMessage.ID.create()
    const cancel = await app.request(`/api/session/${sessionID}/input/${first}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), expectedRevision: 2 }),
    })
    const reorder = await app.request(`/api/session/${sessionID}/input-order`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), expectedRevision: 3, messageIDs: [second] }),
    })

    expect(cancel.status).toBe(200)
    expect(reorder.status).toBe(200)
    expect(domain.calls).toEqual([
      `cancel:${sessionID}:${first}:2`,
      `reorder:${sessionID}:${second}:3`,
    ])
  })

  test("archives a session", async () => {
    database = createTestDatabase().database
    const domain = recordingDomain()
    const sessionID = Session.ID.create()
    const response = await createApp({ database, domain }).request(`/api/session/${sessionID}/archive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
    })

    expect(response.status).toBe(200)
    expect(domain.calls).toEqual([`archive:${sessionID}`])
  })

  test("marks sessions read", async () => {
    database = createTestDatabase().database
    const domain = recordingDomain()
    const sessionIDs = [Session.ID.create(), Session.ID.create()]
    const response = await createApp({ database, domain }).request("/api/session/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), sessionIDs }),
    })

    expect(response.status).toBe(200)
    expect(domain.calls).toEqual([`read:${sessionIDs.join(",")}`])
  })

  test("accepts prompt bodies above the control-plane limit", async () => {
    database = createTestDatabase().database
    const domain = recordingDomain()
    const sessionID = Session.ID.create()
    const response = await createApp({ database, domain }).request(`/api/session/${sessionID}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), prompt: { text: "x".repeat(70 * 1024) } }),
    })

    expect(response.status).toBe(200)
  })

  test("rejects prompt text that cannot fit in a stream frame", async () => {
    database = createTestDatabase().database
    const domain = recordingDomain()
    const response = await createApp({ database, domain }).request(`/api/session/${Session.ID.create()}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), prompt: { text: "x".repeat(1024 * 1024 - 8 * 1024) } }),
    })

    expect(response.status).toBe(413)
    expect(domain.calls).toEqual([])
  })

  test("rejects prompt IDs that cannot fit in a stream frame", async () => {
    database = createTestDatabase().database
    const domain = recordingDomain()
    const response = await createApp({ database, domain }).request(`/api/session/${Session.ID.create()}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        messageID: `msg_${"x".repeat(1024 * 1024)}`,
        prompt: { text: "small" },
      }),
    })

    expect(response.status).toBe(413)
    expect(domain.calls).toEqual([])
  })

  test("rejects oversized session IDs before projection", async () => {
    database = createTestDatabase().database
    const domain = recordingDomain()
    const response = await createApp({ database, domain }).request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        sessionID: `ses_${"x".repeat(520 * 1024)}`,
        location: { directory: "/tmp/project" },
        prompt: { text: "small" },
      }),
    })

    expect(response.status).toBe(413)
    expect(domain.calls).toEqual([])
  })

  test("accounts for the session scope in prompt frame sizing", async () => {
    database = createTestDatabase().database
    const domain = recordingDomain()
    const response = await createApp({ database, domain }).request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        sessionID: `ses_${"x".repeat(64 * 1024 - 4)}`,
        location: { directory: "/tmp/project" },
        prompt: { text: "x".repeat(820 * 1024) },
      }),
    })

    expect(response.status).toBe(413)
    expect(domain.calls).toEqual([])
  })

  test("accounts for prompt IDs in truncated attachment references", async () => {
    database = createTestDatabase().database
    const domain = recordingDomain()
    const response = await createApp({ database, domain }).request(`/api/session/${Session.ID.create()}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        messageID: `msg_${"x".repeat(360 * 1024)}`,
        prompt: { text: "", files: [{ uri: "x".repeat(300 * 1024) }] },
      }),
    })

    expect(response.status).toBe(413)
    expect(domain.calls).toEqual([])
  })

  test("rejects individual attachments larger than five MiB", async () => {
    database = createTestDatabase().database
    const domain = recordingDomain()
    const response = await createApp({ database, domain }).request(`/api/session/${Session.ID.create()}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        prompt: {
          text: "",
          files: [{ uri: `DATA:text/plain;base64,${"A".repeat(Math.ceil((5 * 1024 * 1024 + 1) * 4 / 3))}`, mime: "text/plain" }],
        },
      }),
    })

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ error: { code: "payload_too_large" } })
    expect(domain.calls).toEqual([])
  })

  test("rejects data URI media types that cannot fit in a stream frame", async () => {
    database = createTestDatabase().database
    const domain = recordingDomain()
    const response = await createApp({ database, domain }).request(`/api/session/${Session.ID.create()}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        prompt: { text: "", files: [{ uri: `data:${"x".repeat(1024 * 1024)};base64,QQ==` }] },
      }),
    })

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ error: { code: "payload_too_large" } })
    expect(domain.calls).toEqual([])
  })

  test("rejects malformed data URI attachments", async () => {
    database = createTestDatabase().database
    const domain = recordingDomain()
    const response = await createApp({ database, domain }).request(`/api/session/${Session.ID.create()}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        prompt: { text: "", files: [{ uri: `data:text/plain;base64${"A".repeat(1024 * 1024)}` }] },
      }),
    })

    expect(response.status).toBe(413)
    expect(domain.calls).toEqual([])
  })

  test("maps queue revision failures to the RPC error envelope", async () => {
    database = createTestDatabase().database
    const domain = recordingDomain()
    domain.cancelInput = async () => {
      throw Object.assign(new Error("conflict"), {
        _tag: "Session.QueueRevisionConflictError",
        expected: 2,
        actual: 3,
        messageIDs: ["msg_pending"],
      })
    }
    const response = await createApp({ database, domain }).request("/api/session/ses_1/input/msg_1/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), expectedRevision: 2 }),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: {
        code: "revision_conflict",
        message: "Queue revision does not match",
        details: { expected: 2, actual: 3, messageIDs: ["msg_pending"] },
      },
    })
  })

  test("maps invalid queue mutations to the current queue state", async () => {
    database = createTestDatabase().database
    const domain = recordingDomain()
    domain.reorderInputs = async () => {
      throw Object.assign(new Error("conflict"), {
        _tag: "Session.QueueStateConflictError",
        revision: 4,
        messageIDs: ["msg_pending"],
      })
    }
    const response = await createApp({ database, domain }).request("/api/session/ses_1/input-order", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), expectedRevision: 4, messageIDs: [] }),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: {
        code: "queue_conflict",
        message: "Pending inputs changed",
        details: { revision: 4, messageIDs: ["msg_pending"] },
      },
    })
  })

  test("rejects malformed session and input route IDs", async () => {
    database = createTestDatabase().database
    const domain = recordingDomain()
    const app = createApp({ database, domain })
    const prompt = await app.request("/api/session/invalid/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), prompt: { text: "hello" } }),
    })
    const cancel = await app.request("/api/session/ses_1/input/invalid/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), expectedRevision: 0 }),
    })

    expect(prompt.status).toBe(400)
    expect(cancel.status).toBe(400)
    expect(domain.calls).toEqual([])
  })

  test("maps core idempotency conflicts to the RPC error envelope", async () => {
    database = createTestDatabase().database
    const domain = recordingDomain()
    domain.createSession = async () => {
      throw Object.assign(new Error("conflict"), { code: "idempotency_conflict" })
    }
    const response = await createApp({ database, domain }).request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        location: { directory: "/repo" },
        prompt: { text: "hello" },
      }),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: "idempotency_conflict" } })
  })
})

function recordingDomain(): CoreDomain & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    ready: async () => {},
    createSession: async (input) => {
      const sessionID = input.sessionID ?? "session-generated"
      const messageID = input.messageID ?? "message-generated"
      calls.push(`create:${sessionID}:${messageID}`)
      return { session: { id: sessionID }, admitted: { id: messageID, sessionID }, receipt: receipt(2) }
    },
    admitPrompt: async (sessionID, input) => {
      const messageID = input.messageID ?? "message-generated"
      calls.push(`prompt:${sessionID}:${messageID}`)
      return { admitted: { id: messageID, sessionID }, receipt: receipt() }
    },
    archiveSession: async (sessionID) => {
      calls.push(`archive:${sessionID}`)
      return { receipt: receipt(1) }
    },
    markSessionsRead: async (input) => {
      calls.push(`read:${input.sessionIDs.join(",")}`)
      return { receipt: receipt(input.sessionIDs.length) }
    },
    interrupt: async (sessionID) => { calls.push(`interrupt:${sessionID}`) },
    cancelInput: async (sessionID, messageID, input) => {
      calls.push(`cancel:${sessionID}:${messageID}:${input.expectedRevision}`)
      return { revision: input.expectedRevision + 1, receipt: receipt() }
    },
    reorderInputs: async (sessionID, input) => {
      calls.push(`reorder:${sessionID}:${input.messageIDs.join(",")}:${input.expectedRevision}`)
      return { revision: input.expectedRevision + 1, receipt: receipt() }
    },
    listFiles: async () => [],
    findFiles: async () => [],
    readFile: async () => ({ text: "", totalBytes: 0, truncated: false }),
    replyPermission: async () => ({ outcome: "applied", resolution: {} }),
    replyQuestion: async () => ({ outcome: "applied", resolution: {} }),
    catalog: async () => ({ agents: [], models: [], providers: [] }),
    dispose: async () => {},
  }
}

function receipt(scopeCount = 0) {
  return {
    txid: "tx-test",
    outcome: "applied" as const,
    through: { feedId: "feed-test", seq: 1 },
    affectedScopes: Array.from({ length: scopeCount }, (_, index) => ({ collection: `collection-${index}`, scopeKey: "" })),
  }
}
