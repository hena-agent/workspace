import { Database } from "@hena/core/database/database"
import { makeGlobalNode } from "@hena/core/effect/app-node"
import { EventV2 } from "@hena/core/event"
import { SessionEvent } from "@hena/core/session/event"
import { fromRow } from "@hena/core/session/info"
import { SessionProjector } from "@hena/core/session/projector"
import { SessionInputTable, SessionMessageTable, SessionTable, TodoTable } from "@hena/core/session/sql"
import { ProjectTable } from "@hena/core/project/sql"
import { eq, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Session } from "@hena/schema/session"
import { SessionMessage } from "@hena/schema/session-message"
import { SessionTodo } from "@hena/schema/session-todo"
import { PromptInput } from "@hena/schema/prompt-input"
import { preview } from "../storage/content"
import { fingerprint } from "../storage/fingerprint"
import { fitsPage } from "../stream/pages"

type DatabaseService = Database.Interface["db"]

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const database = yield* Database.Service
    for (const definition of SessionEvent.DurableDefinitions) {
      if (definition.type === SessionEvent.Compaction.Started.type) continue
      yield* events.project(definition, (event) => {
        const sessionID = sessionId(event.data)
        if (!sessionID) return Effect.void
        return refresh(database.db, sessionID, event.type === SessionEvent.Moved.type)
      })
    }
    yield* events.project(SessionEvent.Compaction.Started, (event) => refreshCompactionStart(database.db, event))
    yield* events.project(SessionEvent.Compaction.Discarded, (event) =>
      refreshCompactionDiscarded(database.db, event.data),
    )
    yield* events.project(SessionTodo.Event.Updated, (event) =>
      refreshTodos(database.db, decodeTodoUpdate(event.data).sessionID, crypto.randomUUID()).pipe(Effect.orDie),
    )
  }),
)

export const CollectionProjector = makeGlobalNode({
  name: "server-v3-collection-projector",
  layer,
  deps: [EventV2.node, Database.node, SessionProjector.node],
})

export const MutationTxid = Context.Reference<string | undefined>("@hena/server-v3/MutationTxid", {
  defaultValue: () => undefined,
})

const encodeSession = Schema.encodeUnknownSync(Session.Info)
const decodeMessage = Schema.decodeUnknownSync(SessionMessage.Message)
const encodeMessage = Schema.encodeSync(SessionMessage.Message)
const decodeTodoUpdate = Schema.decodeUnknownSync(SessionTodo.Event.Updated.data)

function refresh(database: DatabaseService, sessionID: string, moved: boolean, mutationTxid?: string) {
  return Effect.gen(function* () {
    const txid = mutationTxid ?? (yield* MutationTxid) ?? crypto.randomUUID()
    const session = yield* database
      .select()
      .from(SessionTable)
      .where(eq(SessionTable.id, Session.ID.make(sessionID)))
      .get()
    if (session) {
      const row = encodeSession(fromRow(session))
      yield* replaceScope(database, "sessions", "", [{ key: session.id, row, revision: fingerprint(row) }], txid, false)
    }
    if (!session) yield* removeScopeRow(database, "sessions", "", sessionID, txid)
    if (session) {
      const project = yield* database.select().from(ProjectTable).where(eq(ProjectTable.id, session.project_id)).get()
      if (project)
        yield* replaceScope(
          database,
          "projects",
          "",
          [
            {
              key: project.id,
              revision: String(project.time_updated),
              row: {
                id: project.id,
                worktree: project.worktree,
                vcs: project.vcs ?? undefined,
                name: project.name ?? undefined,
                icon:
                  project.icon_url || project.icon_url_override || project.icon_color
                    ? {
                        url: project.icon_url ?? undefined,
                        override: project.icon_url_override ?? undefined,
                        color: project.icon_color ?? undefined,
                      }
                    : undefined,
                commands: project.commands ?? undefined,
                sandboxes: project.sandboxes,
                time: {
                  created: project.time_created,
                  updated: project.time_updated,
                  initialized: project.time_initialized ?? undefined,
                },
              },
            },
          ],
          txid,
          false,
        )
    }
    const locationKey =
      session &&
      JSON.stringify({
        directory: session.directory,
        ...(session.workspace_id ? { workspaceID: session.workspace_id } : {}),
      })
    const location =
      locationKey &&
      (yield* database.get(sql`
      SELECT 1 FROM collection_row WHERE collection = 'locations' AND scope_key = '' AND row_key = ${locationKey}
    `))
    if (!session || moved || !location) yield* reconcileLocations(database, txid)

    const messages = yield* database
      .select()
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.session_id, Session.ID.make(sessionID)))
      .all()
    const encoded = messages.map((message) => {
      const row = encodeMessage(decodeMessage({ ...message.data, id: message.id, type: message.type }))
      return { row, revision: fingerprint(row) }
    })
    yield* replaceScope(
      database,
      "messages",
      sessionID,
      encoded.map((message) => ({
        key: message.row.id,
        row: message.row.type === "assistant" ? { ...message.row, content: undefined } : message.row,
        revision: message.revision,
      })),
      txid,
    )
    const parts = yield* Effect.forEach(encoded, (message) =>
      Effect.gen(function* () {
        if (message.row.type !== "assistant") return []
        return yield* Effect.forEach(message.row.content, (part) =>
          Effect.gen(function* () {
            const revision = fingerprint(part)
            const row = yield* projectPart(database, sessionID, message.row.id, revision, part)
            return {
              key: JSON.stringify([message.row.id, part.type, part.id]),
              row: { ...row, messageID: message.row.id },
              revision,
            }
          }),
        )
      }),
    )
    yield* replaceScope(database, "parts", sessionID, parts.flat(), txid)

    const inputs = yield* database
      .select()
      .from(SessionInputTable)
      .where(eq(SessionInputTable.session_id, Session.ID.make(sessionID)))
      .all()
    const projectedInputs = yield* Effect.forEach(inputs, (input) =>
      Effect.gen(function* () {
        const prompt = yield* projectPrompt(database, sessionID, input.id, input.prompt)
        const row = {
          id: input.id,
          sessionID: input.session_id,
          prompt,
          delivery: input.delivery,
          admittedSeq: input.admitted_seq,
          promotedSeq: input.promoted_seq ?? undefined,
          queuePosition: input.queue_position,
          queueRevision: session?.queue_revision ?? 0,
          timeCreated: input.time_created,
        }
        return {
          key: input.id,
          row,
          revision: fingerprint(row),
        }
      }),
    )
    yield* replaceScope(database, "sessionInputs", sessionID, projectedInputs, txid)
    yield* refreshTodos(database, sessionID, txid)
    if (!session) yield* database.run(sql`DELETE FROM full_content WHERE session_id = ${sessionID}`)
  }).pipe(Effect.orDie)
}

function refreshCompactionStart(database: DatabaseService, event: typeof SessionEvent.Compaction.Started.Type) {
  return Effect.gen(function* () {
    const txid = (yield* MutationTxid) ?? crypto.randomUUID()
    yield* refresh(database, event.data.sessionID, false, txid)
    yield* projectCompactionStart(
      database,
      {
        ...event.data,
        metadata: event.metadata,
      },
      txid,
    )
  }).pipe(Effect.orDie)
}

export function projectCompactionStart(
  database: DatabaseService,
  input: (typeof SessionEvent.Compaction.Started.Type)["data"] & { metadata?: Record<string, unknown> },
  txid: string,
) {
  const row = encodeMessage(
    SessionMessage.Compaction.make({
      id: input.messageID,
      type: "compaction",
      metadata: input.metadata,
      reason: input.reason,
      summary: "",
      recent: "",
      time: { created: input.timestamp },
    }),
  )
  return replaceScope(
    database,
    "messages",
    input.sessionID,
    [{ key: input.messageID, row, revision: fingerprint(row) }],
    txid,
    false,
  )
}

export function refreshCompactionDiscarded(
  database: DatabaseService,
  input: (typeof SessionEvent.Compaction.Discarded.Type)["data"],
) {
  return refresh(database, input.sessionID, false)
}

function refreshTodos(database: DatabaseService, sessionID: string, txid: string) {
  return Effect.gen(function* () {
    const todos = yield* database
      .select()
      .from(TodoTable)
      .where(eq(TodoTable.session_id, Session.ID.make(sessionID)))
      .all()
    yield* replaceScope(
      database,
      "todos",
      sessionID,
      todos.map((todo) => ({
        key: todo.id,
        row: { id: todo.id, content: todo.content, status: todo.status, priority: todo.priority },
        revision: String(todo.time_updated),
      })),
      txid,
    )
  })
}

export function reconcileLocations(database: DatabaseService, txid: string) {
  return Effect.gen(function* () {
    const projects = yield* database.select({ directory: ProjectTable.worktree }).from(ProjectTable).all()
    const sessions = yield* database
      .select({ directory: SessionTable.directory, workspaceID: SessionTable.workspace_id })
      .from(SessionTable)
      .all()
    const locations = new Map(
      [
        ...projects.map((project) => ({ directory: project.directory })),
        ...sessions.map((session) => ({
          directory: session.directory,
          ...(session.workspaceID ? { workspaceID: session.workspaceID } : {}),
        })),
      ].map((location) => [JSON.stringify(location), location]),
    )
    yield* replaceScope(
      database,
      "locations",
      "",
      Array.from(locations, ([key, row]) => ({ key, row, revision: "1" })),
      txid,
    )
  })
}

function projectPart(
  database: DatabaseService,
  sessionID: string,
  messageID: string,
  revision: string,
  part: (typeof SessionMessage.AssistantContent)["Encoded"],
) {
  return Effect.gen(function* () {
    if (part.type === "text" || part.type === "reasoning") {
      const text = yield* projectText(database, sessionID, revision, `${messageID}_${part.id}_text`, part.text)
      return { ...part, ...text }
    }
    if (part.state.status === "pending") return part
    const content = yield* Effect.forEach(part.state.content, (item, index) =>
      Effect.gen(function* () {
        if (item.type === "file") return item
        const text = yield* projectText(
          database,
          sessionID,
          revision,
          `${messageID}_${part.id}_tool_${index}`,
          item.text,
        )
        return { ...item, ...text }
      }),
    )
    return { ...part, state: { ...part.state, content } }
  })
}

function projectText(database: DatabaseService, sessionID: string, revision: string, id: string, text: string) {
  return Effect.gen(function* () {
    const projected = preview(text)
    if (!projected.truncated) return { text }
    yield* database.run(sql`
      INSERT OR REPLACE INTO full_content (id, session_id, revision, content, created_at)
      VALUES (${id}, ${sessionID}, ${revision}, ${text}, ${Date.now()})
    `)
    return {
      text: projected.text,
      truncated: true as const,
      content: { id, revision, bytes: projected.totalBytes, lines: projected.totalLines },
    }
  })
}

function projectPrompt(database: DatabaseService, sessionID: string, inputID: string, prompt: PromptInput.Prompt) {
  return Effect.gen(function* () {
    if (!prompt.files) return prompt
    const revision = fingerprint(prompt)
    const files = yield* Effect.forEach(prompt.files, (file, index) =>
      Effect.gen(function* () {
        const projected = preview(file.uri)
        if (!projected.truncated) return file
        const id = `${inputID}_attachment_${index}`
        yield* database.run(sql`
          INSERT OR REPLACE INTO full_content (id, session_id, revision, content, created_at)
          VALUES (${id}, ${sessionID}, ${revision}, ${file.uri}, ${Date.now()})
        `)
        return {
          ...file,
          uri: projected.text,
          truncated: true as const,
          content: { id, revision, bytes: projected.totalBytes },
        }
      }),
    )
    return { ...prompt, files }
  })
}

function replaceScope(
  database: DatabaseService,
  collection: string,
  scopeKey: string,
  rows: ReadonlyArray<{ key: string; row: unknown; revision: string }>,
  txid: string,
  deleteOmitted = true,
) {
  return Effect.gen(function* () {
    const feed = yield* database.get<{ runtime_id: string }>(sql`SELECT runtime_id FROM collection_feed WHERE id = 1`)
    if (!feed) return yield* Effect.die("collection_feed is missing")
    const existing = yield* database.all<{ row_key: string; row: string; row_revision: string }>(sql`
      SELECT row_key, row, row_revision FROM collection_row
      WHERE collection = ${collection} AND scope_key = ${scopeKey}
    `)
    const existingByKey = new Map(existing.map((row) => [row.row_key, row]))
    const incoming = new Set(rows.map((row) => row.key))
    for (const row of rows) {
      const encoded = JSON.stringify(row.row)
      if (!fitsPage([row])) yield* Effect.die("Collection row exceeds stream frame limit")
      const stored = existingByKey.get(row.key)
      if (stored?.row === encoded && stored.row_revision === row.revision) continue
      yield* database.run(sql`
        INSERT INTO collection_row (collection, scope_key, row_key, row, row_revision)
        VALUES (${collection}, ${scopeKey}, ${row.key}, ${encoded}, ${row.revision})
        ON CONFLICT (collection, scope_key, row_key)
        DO UPDATE SET row = excluded.row, row_revision = excluded.row_revision
      `)
      yield* appendChange(database, feed.runtime_id, {
        collection,
        scopeKey,
        rowKey: row.key,
        op: stored ? "update" : "insert",
        row: encoded,
        revision: row.revision,
        txid,
      })
    }
    if (deleteOmitted) {
      for (const stale of existing.filter((row) => !incoming.has(row.row_key))) {
        yield* database.run(sql`
          DELETE FROM collection_row
          WHERE collection = ${collection} AND scope_key = ${scopeKey} AND row_key = ${stale.row_key}
        `)
        yield* appendChange(database, feed.runtime_id, {
          collection,
          scopeKey,
          rowKey: stale.row_key,
          op: "delete",
          row: null,
          txid,
        })
      }
    }
  })
}

function removeScopeRow(database: DatabaseService, collection: string, scopeKey: string, rowKey: string, txid: string) {
  return Effect.gen(function* () {
    const existing = yield* database.get(sql`
      SELECT 1 FROM collection_row
      WHERE collection = ${collection} AND scope_key = ${scopeKey} AND row_key = ${rowKey}
    `)
    if (!existing) return
    const feed = yield* database.get<{ runtime_id: string }>(sql`SELECT runtime_id FROM collection_feed WHERE id = 1`)
    if (!feed) return yield* Effect.die("collection_feed is missing")
    yield* database.run(sql`
      DELETE FROM collection_row
      WHERE collection = ${collection} AND scope_key = ${scopeKey} AND row_key = ${rowKey}
    `)
    return yield* appendChange(database, feed.runtime_id, {
      collection,
      scopeKey,
      rowKey,
      op: "delete",
      row: null,
      txid,
    })
  })
}

function appendChange(
  database: DatabaseService,
  runtimeID: string,
  input: {
    collection: string
    scopeKey: string
    rowKey: string
    op: "insert" | "update" | "delete"
    row: string | null
    revision?: string
    txid: string
  },
) {
  return database.run(sql`
    INSERT INTO collection_change
      (collection, scope_key, row_key, op, row, row_revision, txid, runtime_id, created_at)
    VALUES
      (${input.collection}, ${input.scopeKey}, ${input.rowKey}, ${input.op}, ${input.row}, ${input.revision ?? null}, ${input.txid}, ${runtimeID}, ${Date.now()})
  `)
}

function sessionId(data: unknown) {
  if (typeof data !== "object" || data === null || !("sessionID" in data)) return undefined
  return typeof data.sessionID === "string" ? data.sessionID : undefined
}
