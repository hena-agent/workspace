import { describe, expect, test } from "bun:test"
import { Session } from "@hena/schema/session"
import { SessionMessage } from "@hena/schema/session-message"
import { Location } from "@hena/schema/location"
import { Agent } from "@hena/schema/agent"
import { Model } from "@hena/schema/model"
import { Database } from "bun:sqlite"
import { Schema } from "effect"
import { createCoreDomain } from "../src/core/runtime"
import { createOnlineRequestStore } from "../src/core/online-requests"
import { createSyncDatabase } from "../src/storage/database"

describe("core runtime", () => {
  test("projects only available models and reports provider connection state", async () => {
    const filename = `${process.env.TMPDIR ?? "/tmp"}/hena-server-v3-${crypto.randomUUID()}.sqlite`
    const domain = createCoreDomain(undefined, undefined, undefined, filename)
    await domain.ready()

    try {
      const catalog = await domain.catalog({ directory: process.cwd() })
      const providers = new Map(catalog.providers.map((provider) => [provider.id, provider]))
      expect(catalog.models.length).toBeGreaterThan(0)
      expect(catalog.models.every((model) => model.enabled && providers.get(model.providerID)?.connected)).toBe(true)
      expect(catalog.providers.some((provider) => provider.connected)).toBe(true)
    } finally {
      await domain.dispose()
      await Bun.file(filename).delete()
    }
  })

  test("encodes mutation timestamps as epoch milliseconds", async () => {
    const filename = `${process.env.TMPDIR ?? "/tmp"}/hena-server-v3-${crypto.randomUUID()}.sqlite`
    const bootstrap = createCoreDomain(undefined, undefined, undefined, filename)
    await bootstrap.ready()
    await bootstrap.dispose()
    createSyncDatabase(new Database(filename, { create: true })).close()
    const domain = createCoreDomain(undefined, undefined, undefined, filename)
    await domain.ready()

    try {
      const sessionID = Session.ID.create()
      const created = await domain.createSession({
        idempotencyKey: "create-timestamps",
        sessionID,
        messageID: SessionMessage.ID.create(),
        location: Schema.decodeUnknownSync(Location.Ref)({ directory: process.cwd() }),
        prompt: { text: "first" },
        delivery: "queue",
        agent: Agent.ID.make("build"),
        model: Schema.decodeUnknownSync(Model.Ref)({ id: "alpha", providerID: "opencode-go" }),
      })
      const admitted = await domain.admitPrompt(sessionID, {
        idempotencyKey: "prompt-timestamps",
        messageID: SessionMessage.ID.create(),
        prompt: { text: "second" },
        delivery: "queue",
      })

      if (!created.session.time || typeof created.session.time !== "object" || !("created" in created.session.time))
        throw new Error("Created session response is missing time.created")
      expect(typeof created.session.time.created).toBe("number")
      expect(created.session.queueRevision).toBe(1)
      expect(created.session).toMatchObject({ agent: "build", model: { id: "alpha", providerID: "opencode-go" } })
      expect(typeof created.admitted.timeCreated).toBe("number")
      expect(typeof admitted.admitted.timeCreated).toBe("number")
    } finally {
      await domain.dispose()
      await Bun.file(filename).delete()
    }
  })

  test("archives sessions in storage and the synchronized collection", async () => {
    const filename = `${process.env.TMPDIR ?? "/tmp"}/hena-server-v3-${crypto.randomUUID()}.sqlite`
    const bootstrap = createCoreDomain(undefined, undefined, undefined, filename)
    await bootstrap.ready()
    await bootstrap.dispose()
    createSyncDatabase(new Database(filename, { create: true })).close()
    const domain = createCoreDomain(undefined, undefined, undefined, filename)
    await domain.ready()
    const sessionID = Session.ID.create()

    try {
      await domain.createSession({
        idempotencyKey: crypto.randomUUID(),
        sessionID,
        messageID: SessionMessage.ID.create(),
        location: Schema.decodeUnknownSync(Location.Ref)({ directory: process.cwd() }),
        prompt: { text: "archive me" },
        delivery: "queue",
      })
      const result = await domain.archiveSession(sessionID, { idempotencyKey: crypto.randomUUID() })
      const database = new Database(filename)
      const stored = database.query<{ time_archived: number | null }, [string]>(
        "SELECT time_archived FROM session WHERE id = ?",
      ).get(sessionID)
      const projected = database.query<{ archived: number | null }, [string]>(
        "SELECT json_extract(row, '$.time.archived') AS archived FROM collection_row WHERE collection = 'sessions' AND row_key = ?",
      ).get(sessionID)
      database.close()

      expect(result.receipt.affectedScopes).toContainEqual({ collection: "sessions", scopeKey: "" })
      expect(stored?.time_archived).toBeNumber()
      expect(projected?.archived).toBe(stored?.time_archived)
    } finally {
      await domain.dispose()
      await Bun.file(filename).delete()
    }
  })

  test("does not persist attachment URIs in idempotency responses", async () => {
    const filename = `${process.env.TMPDIR ?? "/tmp"}/hena-server-v3-${crypto.randomUUID()}.sqlite`
    const bootstrap = createCoreDomain(undefined, undefined, undefined, filename)
    await bootstrap.ready()
    await bootstrap.dispose()
    createSyncDatabase(new Database(filename, { create: true })).close()
    const domain = createCoreDomain(undefined, undefined, undefined, filename)
    await domain.ready()
    const dataURI = `DATA:text/plain;base64,${"x".repeat(1024 * 1024)}`
    const remoteURI = `https://attachments.example/${"x".repeat(1024 * 1024)}`
    const sessionID = Session.ID.create()
    const messageID = SessionMessage.ID.create()
    const location = Schema.decodeUnknownSync(Location.Ref)({ directory: process.cwd() })

    try {
      const created = await domain.createSession({
        idempotencyKey: "compact-response",
        sessionID,
        messageID,
        location,
        prompt: { text: "attachment", files: [{ uri: dataURI }, { uri: remoteURI }] },
        delivery: "queue",
      })
      const retried = await domain.createSession({
        idempotencyKey: "compact-response",
        sessionID,
        messageID,
        location,
        prompt: { text: "attachment", files: [{ uri: dataURI }, { uri: remoteURI }] },
        delivery: "queue",
      })
      expect(created.admitted.id).toBeDefined()
      expect(created.admitted).toMatchObject({ prompt: { files: [{ uri: "" }, { uri: "" }] } })
      expect(retried.admitted).toMatchObject({ prompt: { files: [{ uri: "" }, { uri: "" }] } })
    } finally {
      await domain.dispose()
    }

    const database = new Database(filename)
    const stored = database.query<{ response: string }, []>("SELECT response FROM idempotency_record").get()!.response
    database.close()
    await Bun.file(filename).delete()

    expect(stored).not.toContain(dataURI)
    expect(stored).not.toContain(remoteURI)
    expect(stored.length).toBeLessThan(10_000)
  })

  test("rejects filesystem locations that are not exposed", async () => {
    const filename = `${process.env.TMPDIR ?? "/tmp"}/hena-server-v3-${crypto.randomUUID()}.sqlite`
    const bootstrap = createCoreDomain(undefined, undefined, undefined, filename)
    await bootstrap.ready()
    await bootstrap.dispose()
    createSyncDatabase(new Database(filename, { create: true })).close()
    const domain = createCoreDomain(undefined, undefined, undefined, filename)
    await domain.ready()

    try {
      await domain.createSession({
        idempotencyKey: "expose-location",
        sessionID: Session.ID.create(),
        messageID: SessionMessage.ID.create(),
        location: Schema.decodeUnknownSync(Location.Ref)({ directory: process.cwd() }),
        prompt: { text: "first" },
        delivery: "queue",
      })

      await expect(
        domain.listFiles({
          directory: Schema.decodeUnknownSync(Location.Ref)({ directory: "/" }).directory,
          limit: 1,
        }),
      ).rejects.toThrow("Location is unavailable")
    } finally {
      await domain.dispose()
      await Bun.file(filename).delete()
    }
  })

  test("waits for a concurrent writer before reading idempotency state", async () => {
    const filename = `${process.env.TMPDIR ?? "/tmp"}/hena-server-v3-${crypto.randomUUID()}.sqlite`
    const workerPath = `${process.env.TMPDIR ?? "/tmp"}/hena-server-v3-${crypto.randomUUID()}.worker.ts`
    const bootstrap = createCoreDomain(undefined, undefined, undefined, filename)
    await bootstrap.ready()
    await bootstrap.dispose()
    createSyncDatabase(new Database(filename, { create: true })).close()
    const domain = createCoreDomain(undefined, undefined, undefined, filename)
    await domain.ready()
    const location = Schema.decodeUnknownSync(Location.Ref)({ directory: process.cwd() })
    await Bun.write(
      workerPath,
      `import { Database } from "bun:sqlite"
let database
self.onmessage = (event) => {
  database = new Database(event.data.filename)
  database.exec("PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE")
  database.run("UPDATE collection_feed SET retained_floor = retained_floor + 1 WHERE id = 1")
  postMessage("locked")
  setTimeout(() => {
    database.exec("COMMIT")
    database.close()
    postMessage("committed")
  }, 100)
}`,
    )
    const worker = new Worker(workerPath)

    try {
      const locked = nextWorkerMessage(worker)
      worker.postMessage({ filename })
      await locked
      const committed = nextWorkerMessage(worker)
      const mutation = domain.createSession({
        idempotencyKey: "concurrent-writer",
        sessionID: Session.ID.create(),
        messageID: SessionMessage.ID.create(),
        location,
        prompt: { text: "prompt" },
        delivery: "queue",
      })
      await Promise.all([committed, mutation])
    } finally {
      worker.terminate()
      await domain.dispose()
      await Promise.all([Bun.file(filename).delete(), Bun.file(workerPath).delete()])
    }
  })

  test("rejects mismatched pending online replies", async () => {
    const filename = `${process.env.TMPDIR ?? "/tmp"}/hena-server-v3-${crypto.randomUUID()}.sqlite`
    const online = createOnlineRequestStore()
    const domain = createCoreDomain(undefined, online, undefined, filename)
    await domain.ready()
    const location = Schema.decodeUnknownSync(Location.Ref)({ directory: process.cwd() })
    const sessionID = Session.ID.make("ses_1")
    online.project({
      type: "permission.v2.asked",
      data: { id: "per_1", sessionID: "ses_1" },
      location,
    })
    online.project({
      type: "question.v2.asked",
      data: { id: "que_1", sessionID: "ses_1" },
      location,
    })

    try {
      await expect(
        domain.replyPermission("per_1", {
          location,
          sessionID,
          nonce: "wrong",
          reply: "once",
        }),
      ).rejects.toThrow("does not match")
      await expect(
        domain.replyQuestion("que_1", {
          location,
          sessionID: Session.ID.make("ses_wrong"),
          nonce: "wrong",
          answers: [],
        }),
      ).rejects.toThrow("does not match")
      online.complete("permission", "per_1", { requestID: "per_1", sessionID: "ses_1", reply: "once" })
      online.complete("question", "que_1", { requestID: "que_1", sessionID: "ses_1", answers: [] })
      await expect(
        domain.replyPermission("per_1", {
          location,
          sessionID: Session.ID.make("ses_wrong"),
          nonce: "wrong",
          reply: "once",
        }),
      ).rejects.toThrow("does not match")
      await expect(
        domain.replyQuestion("que_1", {
          location,
          sessionID,
          nonce: "wrong",
          answers: [],
        }),
      ).rejects.toThrow("does not match")
    } finally {
      await domain.dispose()
      await Bun.file(filename).delete()
    }
  })
})

function nextWorkerMessage(worker: Worker) {
  return new Promise<void>((resolve) => worker.addEventListener("message", () => resolve(), { once: true }))
}
