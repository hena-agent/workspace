import { describe, expect, test } from "bun:test"
import { Database } from "@hena/core/database/database"
import { DateTime, Effect, Schema } from "effect"
import { sql } from "drizzle-orm"
import {
  projectCompactionStart,
  reconcileLocations,
  refreshCompactionDiscarded,
  refreshDurableEvent,
} from "../src/core/collection-projector"
import { SessionMessage } from "@hena/schema/session-message"
import { Session } from "@hena/schema/session"
import { SessionEvent } from "@hena/schema/session-event"

describe("collection projector", () => {
  test("removes an unused location after a session moves", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { db: database } = yield* Database.Service
        yield* database.run(sql`
          INSERT INTO project (id, worktree, time_created, time_updated, sandboxes)
          VALUES ('global', '/project', 1, 1, '[]')
        `)
        yield* database.run(sql`
          INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
          VALUES ('ses_1', 'global', 'session', '/new', 'Session', '1', 1, 1)
        `)
        yield* database.run(sql`
          INSERT INTO collection_feed (id, feed_id, retained_floor, runtime_id)
          VALUES (1, 'feed', 0, 'runtime')
        `)
        yield* database.run(sql`
          INSERT INTO collection_row (collection, scope_key, row_key, row, row_revision)
          VALUES ('locations', '', '{"directory":"/old"}', '{"directory":"/old"}', '1')
        `)

        yield* reconcileLocations(database, "tx_1")

        expect(
          yield* database.all<{ row_key: string }>(sql`
          SELECT row_key FROM collection_row WHERE collection = 'locations' ORDER BY row_key
        `),
        ).toEqual([{ row_key: '{"directory":"/new"}' }, { row_key: '{"directory":"/project"}' }])
        expect(
          yield* database.get(sql`
          SELECT op, row_key FROM collection_change WHERE txid = 'tx_1' AND op = 'delete'
        `),
        ).toEqual({ op: "delete", row_key: '{"directory":"/old"}' })
      }).pipe(Effect.provide(Database.layerFromPath(":memory:")), Effect.scoped),
    )
  })

  test("projects a provisional compaction row for live deltas", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { db: database } = yield* Database.Service
        yield* database.run(sql`
          INSERT INTO collection_feed (id, feed_id, retained_floor, runtime_id)
          VALUES (1, 'feed', 0, 'runtime')
        `)

        yield* projectCompactionStart(
          database,
          {
            sessionID: Session.ID.make("ses_1"),
            messageID: SessionMessage.ID.make("msg_compaction"),
            timestamp: DateTime.makeUnsafe(1),
            reason: "auto",
          },
          "tx_1",
        )

        expect(
          yield* database.get<{ row: string }>(sql`
          SELECT row FROM collection_row
          WHERE collection = 'messages' AND scope_key = 'ses_1' AND row_key = 'msg_compaction'
        `),
        ).toMatchObject({ row: expect.stringContaining('"type":"compaction"') })
      }).pipe(Effect.provide(Database.layerFromPath(":memory:")), Effect.scoped),
    )
  })

  test("removes a provisional compaction row when compaction is discarded", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { db: database } = yield* Database.Service
        yield* database.run(sql`
          INSERT INTO collection_feed (id, feed_id, retained_floor, runtime_id)
          VALUES (1, 'feed', 0, 'runtime')
        `)
        const event = {
          sessionID: Session.ID.make("ses_1"),
          messageID: SessionMessage.ID.make("msg_compaction"),
          timestamp: DateTime.makeUnsafe(1),
          reason: "auto" as const,
        }
        yield* projectCompactionStart(database, event, "tx_1")

        yield* refreshCompactionDiscarded(database, event)

        expect(
          yield* database.get(sql`
            SELECT row FROM collection_row
            WHERE collection = 'messages' AND scope_key = 'ses_1' AND row_key = 'msg_compaction'
          `),
        ).toBeUndefined()
      }).pipe(Effect.provide(Database.layerFromPath(":memory:")), Effect.scoped),
    )
  })

  test("refreshes only the message affected by a provider event", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { db: database } = yield* Database.Service
        yield* database.run(sql`
          INSERT INTO project (id, worktree, time_created, time_updated, sandboxes)
          VALUES ('global', '/project', 1, 1, '[]')
        `)
        yield* database.run(sql`
          INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
          VALUES ('ses_1', 'global', 'session', '/project', 'Session', '1', 1, 1)
        `)
        yield* database.run(sql`
          INSERT INTO collection_feed (id, feed_id, retained_floor, runtime_id)
          VALUES (1, 'feed', 0, 'runtime')
        `)
        yield* database.run(sql`
          INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
          VALUES
            ('msg_target', 'ses_1', 'assistant', 1, 1, 1,
              '{"agent":"build","model":{"id":"model","providerID":"provider"},"content":[],"time":{"created":1}}'),
            ('msg_unrelated', 'ses_1', 'assistant', 2, 1, 1, '{}')
        `)

        yield* refreshDurableEvent(database, {
          type: SessionEvent.Step.Ended.type,
          data: { sessionID: "ses_1", assistantMessageID: "msg_target" },
        })

        expect(
          yield* database.get<{ row_key: string }>(sql`
            SELECT row_key FROM collection_row
            WHERE collection = 'messages' AND scope_key = 'ses_1'
          `),
        ).toEqual({ row_key: "msg_target" })
      }).pipe(Effect.provide(Database.layerFromPath(":memory:")), Effect.scoped),
    )
  })

  test("stores promoted user attachments outside the stream row", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { db: database } = yield* Database.Service
        yield* database.run(sql`
          INSERT INTO project (id, worktree, time_created, time_updated, sandboxes)
          VALUES ('global', '/project', 1, 1, '[]')
        `)
        yield* database.run(sql`
          INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
          VALUES ('ses_1', 'global', 'session', '/project', 'Session', '1', 1, 1)
        `)
        yield* database.run(sql`
          INSERT INTO collection_feed (id, feed_id, retained_floor, runtime_id)
          VALUES (1, 'feed', 0, 'runtime')
        `)
        yield* database.run(sql`
          INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
          VALUES ('msg_user', 'ses_1', 'user', 1, 1, 1, ${JSON.stringify({
            text: "",
            files: [{ uri: `data:text/plain;base64,${"A".repeat(2 * 1024 * 1024)}`, mime: "text/plain" }],
            time: { created: 1 },
          })})
        `)

        yield* refreshDurableEvent(database, {
          type: SessionEvent.Prompted.type,
          data: { sessionID: "ses_1", messageID: "msg_user" },
        })

        const projected = yield* database.get<{ row: string }>(sql`
          SELECT row FROM collection_row
          WHERE collection = 'messages' AND scope_key = 'ses_1' AND row_key = 'msg_user'
        `)
        expect(projected && Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(projected.row)).toMatchObject({
          files: [{ truncated: true, content: { bytes: expect.any(Number) } }],
        })
        expect(yield* database.get<{ bytes: number }>(sql`
          SELECT length(content) AS bytes FROM full_content WHERE id = 'msg_user_attachment_0'
        `)).toMatchObject({ bytes: expect.any(Number) })
      }).pipe(Effect.provide(Database.layerFromPath(":memory:")), Effect.scoped),
    )
  })
})
