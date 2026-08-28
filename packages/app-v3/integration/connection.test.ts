import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync } from "node:fs"
import { Session } from "@hena/schema/session"
import { SessionMessage } from "@hena/schema/session-message"
import { createApp } from "../../server-v3/src/app"
import { bootstrapCollections } from "../../server-v3/src/core/bootstrap"
import { createCoreDomain } from "../../server-v3/src/core/runtime"
import { createOnlineRequestStore } from "../../server-v3/src/core/online-requests"
import { createSyncDatabase } from "../../server-v3/src/storage/database"
import { createDeltaHub } from "../../server-v3/src/stream/delta"
import { createConnectionAgent } from "../src/connection/agent"
import { createSessionOptimistically } from "../src/mutations/session"

describe("connection agent with server-v3", () => {
  test("streams authoritative snapshots and mutation rows from the real Hono app", async () => {
    const filename = `${process.env.TMPDIR ?? "/tmp"}/hena-app-v3-${crypto.randomUUID()}.sqlite`
    const deltas = createDeltaHub()
    const online = createOnlineRequestStore()
    const persisted = { publish: () => {} }
    const domain = createCoreDomain(deltas, online, () => persisted.publish(), filename)
    await domain.ready()
    const database = createSyncDatabase(new Database(filename, { create: true }))
    persisted.publish = database.changes.publishPersisted
    bootstrapCollections(database)
    const app = createApp({ database, domain, deltas, online })
    const subscriptions: unknown[] = []
    const agent = createConnectionAgent("http://hena.test", async (input, init) => {
      const request = new Request(input, init)
      if (request.url.endsWith("/subscription")) subscriptions.push(await request.clone().json())
      return app.request(request)
    })
    const sessionID = Session.ID.create()
    const release = agent.claim(sessionID)

    try {
      void agent.start()
      await waitUntil(
        () => agent.store.isReady("projects") && agent.store.isReady("sessions"),
        () => `${agent.status}: ${agent.errorMessage} ${JSON.stringify(agent.store.scopeRefs())}`,
      )
      expect(agent.store.rows("projects")).toEqual([])

      const response = await agent.client.api.session.$post({
        json: {
          idempotencyKey: crypto.randomUUID(),
          sessionID,
          messageID: SessionMessage.ID.create(),
          location: { directory: process.cwd() },
          prompt: { text: "queued from integration test" },
          delivery: "queue",
        },
      })
      expect(response.ok).toBe(true)
      const result = await response.json()
      await agent.store.awaitTxid(result.receipt.txid, 2_000, result.receipt.affectedScopes)
      await waitUntil(() => agent.store.rows("sessions").some((row) => row.id === sessionID))

      expect(agent.store.rows("projects").length).toBe(1)
      expect(agent.store.rows("sessions")).toContainEqual(expect.objectContaining({ id: sessionID }))
      const identity = {
        sessionId: sessionID,
        messageId: SessionMessage.ID.create(),
        partId: "text-0",
        partKind: "text" as const,
      }
      expect(subscriptions).toContainEqual(expect.objectContaining({ sessions: [sessionID] }))
      deltas.publish({ ...identity, text: "streaming" })
      await waitUntil(() => agent.store.delta(identity)?.text === "streaming")
      expect(agent.store.delta(identity)).toEqual({ text: "streaming", incomplete: false })
      const reasoning = {
        sessionId: sessionID,
        messageId: SessionMessage.ID.create(),
        partId: "reasoning-0",
        partKind: "reasoning" as const,
      }
      deltas.publish({ ...reasoning, text: "live reasoning" })
      await waitUntil(() => agent.store.delta(reasoning)?.text === "live reasoning")
      expect(agent.store.deltaIdentities(sessionID)).toContainEqual(reasoning)
      release()
    } finally {
      agent.dispose()
      await domain.dispose()
      database.close()
      await Bun.file(filename).delete()
    }
  }, 15_000)
})

describe("starting a session in a brand new directory", () => {
  test("the rail's project list and the optimistic session both pick up the real project id", async () => {
    const filename = `${process.env.TMPDIR ?? "/tmp"}/hena-app-v3-${crypto.randomUUID()}.sqlite`
    const deltas = createDeltaHub()
    const online = createOnlineRequestStore()
    const persisted = { publish: () => {} }
    const domain = createCoreDomain(deltas, online, () => persisted.publish(), filename)
    await domain.ready()
    const database = createSyncDatabase(new Database(filename, { create: true }))
    persisted.publish = database.changes.publishPersisted
    bootstrapCollections(database)
    const app = createApp({ database, domain, deltas, online })
    const agent = createConnectionAgent("http://hena.test", (input, init) =>
      app.request(input instanceof Request ? new Request(input, init) : new Request(input, init)))
    const directory = mkdtempSync(`${process.env.TMPDIR ?? "/tmp"}/hena-add-project-`)

    try {
      void agent.start()
      await waitUntil(
        () => agent.store.isReady("projects") && agent.store.isReady("sessions"),
        () => `${agent.status}: ${agent.errorMessage} ${JSON.stringify(agent.store.scopeRefs())}`,
      )
      expect(agent.store.rows("projects")).toEqual([])

      const created = createSessionOptimistically(agent, {
        projectID: "pending",
        location: { directory },
        text: "hello from a brand new project",
        delivery: "steer",
        agentID: "",
      })
      const release = agent.claim(created.sessionID)

      expect(agent.store.rows("sessions").find((row) => row.id === created.sessionID)?.projectID).toBe("pending")

      // Resolve the real ID only after its receipt is visible so navigation cannot remove the
      // draft rail item before the authoritative project row is available.
      const resolvedProjectID = await created.projectID
      expect(resolvedProjectID).not.toBe("pending")

      await created.transaction.isPersisted.promise

      const session = agent.store.rows("sessions").find((row) => row.id === created.sessionID)
      expect(session?.projectID).toBe(resolvedProjectID)
      await waitUntil(() => agent.store.rows("projects").some((row) => row.id === resolvedProjectID))
      expect(agent.store.rows("projects")).toContainEqual(expect.objectContaining({ id: resolvedProjectID }))
      release()
    } finally {
      agent.dispose()
      await domain.dispose()
      database.close()
      await Bun.file(filename).delete()
    }
  }, 15_000)
})

async function waitUntil(predicate: () => boolean, detail?: () => string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return
    await Bun.sleep(10)
  }
  throw new Error(`Timed out waiting for synchronized state${detail ? ` (${detail()})` : ""}`)
}
