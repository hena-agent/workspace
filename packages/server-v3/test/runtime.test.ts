import { describe, expect, test } from "bun:test"
import { Session } from "@hena/schema/session"
import { SessionMessage } from "@hena/schema/session-message"
import { Location } from "@hena/schema/location"
import { Database } from "bun:sqlite"
import { Schema } from "effect"
import { createCoreDomain } from "../src/core/runtime"
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
      expect(typeof created.admitted.timeCreated).toBe("number")
      expect(typeof admitted.admitted.timeCreated).toBe("number")
    } finally {
      await domain.dispose()
      await Bun.file(filename).delete()
    }
  })
})
