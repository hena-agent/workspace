import { describe, expect, test } from "bun:test"
import { Database } from "@hena/core/database/database"
import { DateTime, Effect, Schema } from "effect"
import { sql } from "drizzle-orm"
import {
  projectCompactionStart,
  reconcileLocations,
  refreshCompactionDiscarded,
  refreshDurableEvent,
  refreshTodos,
} from "../src/core/collection-projector"
import { SessionMessage } from "@hena/schema/session-message"
import { Session } from "@hena/schema/session"
import { SessionEvent } from "@hena/schema/session-event"

describe("collection projector", () => {
  test("projects ID-preserving todo reordering", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { db: database } = yield* Database.Service
        yield* database.run(
          sql`INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES ('global', '/project', 1, 1, '[]')`,
        )
        yield* database.run(
          sql`INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('ses_1', 'global', 'session', '/project', 'Session', '1', 1, 1)`,
        )
        yield* database.run(
          sql`INSERT INTO collection_feed (id, feed_id, retained_floor, runtime_id) VALUES (1, 'feed', 0, 'runtime')`,
        )
        yield* database.run(sql`
          INSERT INTO todo (id, session_id, content, status, priority, position, time_created, time_updated)
          VALUES
            ('todo_1', 'ses_1', 'First', 'pending', 'high', 0, 1, 1),
            ('todo_2', 'ses_1', 'Second', 'pending', 'low', 1, 1, 1)
        `)
        yield* refreshTodos(database, "ses_1", "tx_initial")
        yield* database.run(sql`UPDATE todo SET position = -1 WHERE id = 'todo_1'`)
        yield* database.run(sql`UPDATE todo SET position = 0 WHERE id = 'todo_2'`)
        yield* database.run(sql`UPDATE todo SET position = 1 WHERE id = 'todo_1'`)

        yield* refreshTodos(database, "ses_1", "tx_reordered")

        const rows = yield* database.all<{ row: string }>(sql`
          SELECT row FROM collection_row
          WHERE collection = 'todos' AND scope_key = 'ses_1'
          ORDER BY row_key
        `)
        expect(rows.map((row) => Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(row.row))).toEqual([
          { id: "todo_1", content: "First", status: "pending", priority: "high", position: 1 },
          { id: "todo_2", content: "Second", status: "pending", priority: "low", position: 0 },
        ])
        expect(
          yield* database.get<{ count: number }>(sql`
            SELECT COUNT(*) AS count FROM collection_change
            WHERE collection = 'todos' AND txid = 'tx_reordered'
          `),
        ).toEqual({ count: 2 })
      }).pipe(Effect.provide(Database.layerFromPath(":memory:")), Effect.scoped),
    )
  })

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

  test("does not rewrite promoted input history when the queue revision changes", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { db: database } = yield* Database.Service
        yield* database.run(
          sql`INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES ('global', '/project', 1, 1, '[]')`,
        )
        yield* database.run(
          sql`INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated, queue_revision) VALUES ('ses_1', 'global', 'session', '/project', 'Session', '1', 1, 1, 101)`,
        )
        yield* database.run(
          sql`INSERT INTO collection_feed (id, feed_id, retained_floor, runtime_id) VALUES (1, 'feed', 0, 'runtime')`,
        )
        yield* Effect.forEach(
          Array.from({ length: 100 }),
          (_, index) =>
            database.run(
              sql`INSERT INTO session_input (id, session_id, prompt, delivery, admitted_seq, queue_position, promoted_seq, time_created) VALUES (${`msg_history_${index}`}, 'ses_1', '{"text":"old"}', 'steer', ${index + 1}, 0, ${index + 1}, 1)`,
            ),
          { discard: true },
        )
        yield* database.run(
          sql`INSERT INTO session_input (id, session_id, prompt, delivery, admitted_seq, queue_position, promoted_seq, time_created) VALUES ('msg_pending', 'ses_1', '{"text":"pending"}', 'queue', 101, 0, NULL, 1)`,
        )

        yield* refreshDurableEvent(database, {
          type: SessionEvent.PromptAdmitted.type,
          data: { sessionID: "ses_1", messageID: "msg_pending" },
        })

        expect(
          yield* database.get<{ count: number }>(
            sql`SELECT COUNT(*) AS count FROM collection_change WHERE collection = 'sessionInputs'`,
          ),
        ).toEqual({ count: 1 })
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

  test("refreshes the assistant superseded by a new provider step", async () => {
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
        const incomplete = {
          id: "msg_previous",
          type: "assistant",
          agent: "build",
          model: { id: "model", providerID: "provider" },
          content: [],
          time: { created: 1 },
        }
        yield* database.run(sql`
          INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
          VALUES
            ('msg_previous', 'ses_1', 'assistant', 1, 1, 2, ${JSON.stringify({ ...incomplete, time: { created: 1, completed: 2 } })}),
            ('msg_current', 'ses_1', 'assistant', 2, 2, 2, ${JSON.stringify({ ...incomplete, id: "msg_current", time: { created: 2 } })})
        `)
        yield* database.run(sql`
          INSERT INTO collection_row (collection, scope_key, row_key, row, row_revision)
          VALUES ('messages', 'ses_1', 'msg_previous', ${JSON.stringify(incomplete)}, 'stale')
        `)

        yield* refreshDurableEvent(database, {
          type: SessionEvent.Step.Started.type,
          data: { sessionID: "ses_1", assistantMessageID: "msg_current" },
        })

        const projected = yield* database.get<{ row: string }>(sql`
          SELECT row FROM collection_row
          WHERE collection = 'messages' AND scope_key = 'ses_1' AND row_key = 'msg_previous'
        `)
        expect(projected && Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(projected.row)).toMatchObject({
          time: { completed: 2 },
        })
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
        expect(
          yield* database.get<{ bytes: number }>(sql`
          SELECT length(content) AS bytes FROM full_content WHERE id = 'msg_user_attachment_0'
        `),
        ).toMatchObject({ bytes: expect.any(Number) })
      }).pipe(Effect.provide(Database.layerFromPath(":memory:")), Effect.scoped),
    )
  })

  test("bounds pending tool input before writing stream rows", async () => {
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
          VALUES ('msg_tool', 'ses_1', 'assistant', 1, 1, 1, ${JSON.stringify({
            agent: "build",
            model: { id: "model", providerID: "provider" },
            content: [
              {
                type: "tool",
                id: "tool_1",
                name: "bash",
                state: { status: "pending", input: "x".repeat(2 * 1024 * 1024) },
                time: { created: 1 },
              },
            ],
            time: { created: 1 },
          })})
        `)

        yield* refreshDurableEvent(database, {
          type: SessionEvent.Step.Ended.type,
          data: { sessionID: "ses_1", assistantMessageID: "msg_tool" },
        })

        const projected = yield* database.get<{ row: string }>(sql`
          SELECT row FROM collection_row
          WHERE collection = 'parts' AND scope_key = 'ses_1'
        `)
        expect(projected?.row.length).toBeLessThan(1024 * 1024)
        expect(projected && Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(projected.row)).toMatchObject({
          ordinal: 0,
          state: { input: expect.any(String), truncated: true, content: { bytes: 2 * 1024 * 1024 } },
        })
        expect(
          yield* database.get<{ bytes: number }>(sql`
            SELECT length(content) AS bytes FROM full_content WHERE id = 'msg_tool_tool_1_tool_input'
          `),
        ).toMatchObject({ bytes: 2 * 1024 * 1024 })
      }).pipe(Effect.provide(Database.layerFromPath(":memory:")), Effect.scoped),
    )
  })

  test("bounds completed tool results before writing stream rows", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { db: database } = yield* Database.Service
        yield* database.run(sql`INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES ('global', '/project', 1, 1, '[]')`)
        yield* database.run(sql`INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('ses_1', 'global', 'session', '/project', 'Session', '1', 1, 1)`)
        yield* database.run(sql`INSERT INTO collection_feed (id, feed_id, retained_floor, runtime_id) VALUES (1, 'feed', 0, 'runtime')`)
        yield* database.run(sql`
          INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
          VALUES ('msg_tool', 'ses_1', 'assistant', 1, 1, 1, ${JSON.stringify({
            agent: "build",
            model: { id: "model", providerID: "provider" },
            content: [{
              type: "tool",
              id: "tool_1",
              name: "bash",
              state: { status: "completed", input: {}, structured: {}, content: [], result: { value: "x".repeat(2 * 1024 * 1024) } },
              time: { created: 1, completed: 2 },
            }],
            time: { created: 1 },
          })})
        `)

        yield* refreshDurableEvent(database, {
          type: SessionEvent.Step.Ended.type,
          data: { sessionID: "ses_1", assistantMessageID: "msg_tool" },
        })

        const projected = yield* database.get<{ row: string }>(sql`SELECT row FROM collection_row WHERE collection = 'parts' AND scope_key = 'ses_1'`)
        expect(projected?.row.length).toBeLessThan(1024 * 1024)
        expect(projected && Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(projected.row)).toMatchObject({
          state: { result: { truncated: true, content: { bytes: expect.any(Number) } } },
        })
      }).pipe(Effect.provide(Database.layerFromPath(":memory:")), Effect.scoped),
    )
  })

  test("projects oversized shell output before writing stream rows", async () => {
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
          VALUES ('msg_shell', 'ses_1', 'shell', 1, 1, 1, ${JSON.stringify({
            callID: "call_1",
            command: "build",
            output: "x".repeat(2 * 1024 * 1024),
            time: { created: 1 },
          })})
        `)

        yield* refreshDurableEvent(database, {
          type: SessionEvent.Shell.Ended.type,
          data: { sessionID: "ses_1", callID: "call_1" },
        })

        const projected = yield* database.get<{ row: string }>(sql`
          SELECT row FROM collection_row
          WHERE collection = 'messages' AND scope_key = 'ses_1' AND row_key = 'msg_shell'
        `)
        expect(projected?.row.length).toBeLessThan(1024 * 1024)
        expect(projected && Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(projected.row)).toMatchObject({
          output: expect.any(String),
          truncated: true,
          content: { bytes: 2 * 1024 * 1024 },
        })
      }).pipe(Effect.provide(Database.layerFromPath(":memory:")), Effect.scoped),
    )
  })
})
