import { describe, expect, test } from "bun:test"
import { Session } from "@hena/schema/session"
import { SessionMessage } from "@hena/schema/session-message"
import { Location } from "@hena/schema/location"
import { Database } from "bun:sqlite"
import { Schema } from "effect"
import { createCoreDomain } from "../src/core/runtime"
import { createOnlineRequestStore } from "../src/core/online-requests"
import { createSyncDatabase } from "../src/storage/database"

describe("core runtime", () => {
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
      expect(typeof created.admitted.timeCreated).toBe("number")
      expect(typeof admitted.admitted.timeCreated).toBe("number")
    } finally {
      await domain.dispose()
      await Bun.file(filename).delete()
    }
  })

  test("does not persist inline attachment contents in idempotency responses", async () => {
    const filename = `${process.env.TMPDIR ?? "/tmp"}/hena-server-v3-${crypto.randomUUID()}.sqlite`
    const bootstrap = createCoreDomain(undefined, undefined, undefined, filename)
    await bootstrap.ready()
    await bootstrap.dispose()
    createSyncDatabase(new Database(filename, { create: true })).close()
    const domain = createCoreDomain(undefined, undefined, undefined, filename)
    await domain.ready()
    const uri = `DATA:text/plain;base64,${"x".repeat(1024 * 1024)}`
    const sessionID = Session.ID.create()
    const messageID = SessionMessage.ID.create()
    const location = Schema.decodeUnknownSync(Location.Ref)({ directory: process.cwd() })

    try {
      const created = await domain.createSession({
        idempotencyKey: "compact-response",
        sessionID,
        messageID,
        location,
        prompt: { text: "attachment", files: [{ uri }] },
        delivery: "queue",
      })
      const retried = await domain.createSession({
        idempotencyKey: "compact-response",
        sessionID,
        messageID,
        location,
        prompt: { text: "attachment", files: [{ uri }] },
        delivery: "queue",
      })
      expect(created.admitted.id).toBeDefined()
      expect(created.admitted).toMatchObject({ prompt: { files: [{ uri: "" }] } })
      expect(retried.admitted).toMatchObject({ prompt: { files: [{ uri: "" }] } })
    } finally {
      await domain.dispose()
    }

    const database = new Database(filename)
    const stored = database.query<{ response: string }, []>("SELECT response FROM idempotency_record").get()!.response
    database.close()
    await Bun.file(filename).delete()

    expect(stored).not.toContain(uri)
    expect(stored.length).toBeLessThan(10_000)
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
