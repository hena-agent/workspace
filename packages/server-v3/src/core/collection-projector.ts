import { Database } from "@hena/core/database/database"
import { makeGlobalNode } from "@hena/core/effect/app-node"
import { EventV2 } from "@hena/core/event"
import { SessionEvent } from "@hena/core/session/event"
import { fromRow } from "@hena/core/session/info"
import { SessionProjector } from "@hena/core/session/projector"
import { SessionInputTable, SessionMessageTable, SessionTable, TodoTable } from "@hena/core/session/sql"
import { ProjectTable } from "@hena/core/project/sql"
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Session } from "@hena/schema/session"
import { SessionMessage } from "@hena/schema/session-message"
import { SessionTodo } from "@hena/schema/session-todo"
import { PromptInput } from "@hena/schema/prompt-input"
import { preview } from "../storage/content"
import { fingerprint } from "../storage/fingerprint"
import { fitsCollectionRow } from "../stream/pages"

type DatabaseService = Database.Interface["db"]

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const database = yield* Database.Service
    for (const definition of SessionEvent.DurableDefinitions) {
      if (
        definition.type === SessionEvent.Compaction.Started.type ||
        definition.type === SessionEvent.Compaction.Discarded.type
      )
        continue
      yield* events.project(definition, (event) => {
        const sessionID = sessionId(event.data)
        if (!sessionID) return Effect.void
        return refreshDurableEvent(database.db, {
          type: event.type,
          data: {
            ...event.data,
            sessionID,
          },
        })
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
const workingSessions = new Set<string>()

export function refreshDurableEvent(
  database: DatabaseService,
  event: {
    type: string
    data: {
      sessionID: string
      messageID?: string
      assistantMessageID?: string
      callID?: string
      delivery?: string
      finish?: string
    }
  },
) {
  return Effect.gen(function* () {
    if (event.type === SessionEvent.Retried.type) return
    const txid = (yield* MutationTxid) ?? crypto.randomUUID()
    if (event.type === SessionEvent.Prompted.type ||
      (event.type === SessionEvent.PromptAdmitted.type && "delivery" in event.data && event.data.delivery !== "queue"))
      workingSessions.add(event.data.sessionID)
    if (event.type === SessionEvent.Step.Failed.type ||
      (event.type === SessionEvent.Step.Ended.type && (!("finish" in event.data) || event.data.finish !== "tool-calls")))
      workingSessions.delete(event.data.sessionID)
    if (event.type === SessionEvent.RevertEvent.Committed.type) {
      yield* refreshSession(database, event.data.sessionID, false, txid)
      yield* refreshMessages(database, event.data.sessionID, txid)
      yield* refreshInputs(database, event.data.sessionID, txid)
      return
    }

    yield* refreshSession(database, event.data.sessionID, event.type === SessionEvent.Moved.type, txid)
    if (
      event.type === SessionEvent.Prompted.type ||
      event.type === SessionEvent.PromptAdmitted.type ||
      event.type === SessionEvent.InputCanceled.type ||
      event.type === SessionEvent.InputReordered.type
    )
      yield* refreshInputs(database, event.data.sessionID, txid)
    if (event.type === SessionEvent.Shell.Ended.type) {
      const shell = yield* database.get<{ id: string }>(sql`
        SELECT id FROM session_message
        WHERE session_id = ${event.data.sessionID} AND type = 'shell'
          AND json_extract(data, '$.callID') = ${event.data.callID}
      `)
      if (shell) yield* refreshMessage(database, event.data.sessionID, shell.id, txid)
      return
    }

    if (event.type === SessionEvent.Step.Started.type && event.data.assistantMessageID) {
      const previous = yield* database
        .select({ id: SessionMessageTable.id })
        .from(SessionMessageTable)
        .where(
          and(
            eq(SessionMessageTable.session_id, Session.ID.make(event.data.sessionID)),
            eq(SessionMessageTable.type, "assistant"),
            ne(SessionMessageTable.id, SessionMessage.ID.make(event.data.assistantMessageID)),
          ),
        )
        .orderBy(desc(SessionMessageTable.seq))
        .limit(1)
        .get()
      if (previous) yield* refreshMessage(database, event.data.sessionID, previous.id, txid)
    }

    const messageID =
      event.type === SessionEvent.AgentSwitched.type ||
      event.type === SessionEvent.ModelSwitched.type ||
      event.type === SessionEvent.Prompted.type ||
      event.type === SessionEvent.ContextUpdated.type ||
      event.type === SessionEvent.Synthetic.type ||
      event.type === SessionEvent.Shell.Started.type ||
      event.type === SessionEvent.Compaction.Ended.type
        ? event.data.messageID
        : event.data.assistantMessageID
    if (messageID) yield* refreshMessage(database, event.data.sessionID, messageID, txid)
  }).pipe(Effect.orDie)
}

function refreshSession(database: DatabaseService, sessionID: string, moved: boolean, txid: string) {
  return Effect.gen(function* () {
    const session = yield* database
      .select()
      .from(SessionTable)
      .where(eq(SessionTable.id, Session.ID.make(sessionID)))
      .get()
    if (session) {
      const row = { ...encodeSession(fromRow(session)), working: workingSessions.has(sessionID) }
      yield* replaceScopeRow(database, "sessions", "", { key: session.id, row, revision: fingerprint(row) }, txid)
    }
    if (!session) yield* removeScopeRow(database, "sessions", "", sessionID, txid)
    if (session) {
      const project = yield* database.select().from(ProjectTable).where(eq(ProjectTable.id, session.project_id)).get()
      if (project)
        yield* replaceScopeRow(
          database,
          "projects",
          "",
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
          txid,
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
  })
}

export function setSessionWorking(database: DatabaseService, sessionID: string, working: boolean, txid: string) {
  if (working) workingSessions.add(sessionID)
  if (!working) workingSessions.delete(sessionID)
  return refreshSession(database, sessionID, false, txid)
}

export function setSessionArchived(database: DatabaseService, sessionID: string, archivedAt: number, txid: string) {
  return Effect.gen(function* () {
    yield* database
      .update(SessionTable)
      .set({ time_archived: archivedAt })
      .where(eq(SessionTable.id, Session.ID.make(sessionID)))
      .run()
    yield* refreshSession(database, sessionID, false, txid)
  })
}

export function resetWorkingSessions() {
  workingSessions.clear()
}

function refreshMessages(database: DatabaseService, sessionID: string, txid: string) {
  return Effect.gen(function* () {
    const messages = yield* database
      .select()
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.session_id, Session.ID.make(sessionID)))
      .all()
    const encoded = messages.map((message) => {
      const row = encodeMessage(decodeMessage({ ...message.data, id: message.id, type: message.type }))
      return { row, revision: fingerprint(row) }
    })
    const projected = yield* Effect.forEach(encoded, (message) =>
      Effect.gen(function* () {
        const row = yield* projectMessageRow(database, sessionID, message.row)
        return { key: message.row.id, row, revision: message.revision }
      }),
    )
    yield* replaceScope(database, "messages", sessionID, projected, txid)
    const parts = yield* Effect.forEach(encoded, (message) => projectMessageParts(database, sessionID, message.row))
    yield* replaceScope(database, "parts", sessionID, parts.flat(), txid)
  })
}

function refreshMessage(database: DatabaseService, sessionID: string, messageID: string, txid: string) {
  return Effect.gen(function* () {
    const message = yield* database
      .select()
      .from(SessionMessageTable)
      .where(
        sql`${SessionMessageTable.session_id} = ${Session.ID.make(sessionID)} AND ${SessionMessageTable.id} = ${SessionMessage.ID.make(messageID)}`,
      )
      .get()
    if (!message) {
      yield* removeScopeRow(database, "messages", sessionID, messageID, txid)
      yield* replaceMessageParts(database, sessionID, messageID, [], txid)
      return
    }
    const row = encodeMessage(decodeMessage({ ...message.data, id: message.id, type: message.type }))
    const revision = fingerprint(row)
    yield* replaceScopeRow(
      database,
      "messages",
      sessionID,
      {
        key: message.id,
        row: yield* projectMessageRow(database, sessionID, row),
        revision,
      },
      txid,
    )
    yield* replaceMessageParts(
      database,
      sessionID,
      messageID,
      yield* projectMessageParts(database, sessionID, row),
      txid,
    )
  })
}

function projectMessageRow(
  database: DatabaseService,
  sessionID: string,
  message: (typeof SessionMessage.Message)["Encoded"],
) {
  if (message.type === "assistant") return Effect.succeed({ ...message, content: undefined })
  if (message.type === "user")
    return Effect.map(
      projectPrompt(database, sessionID, message.id, {
        text: message.text,
        files: message.files,
        agents: message.agents,
      }),
      (prompt) => ({ ...message, ...prompt }),
    )
  if (message.type === "system" || message.type === "synthetic")
    return Effect.map(
      projectText(database, sessionID, fingerprint(message), `${message.id}_text`, message.text),
      (text) => ({ ...message, ...text }),
    )
  if (message.type === "shell")
    return Effect.map(
      projectText(database, sessionID, fingerprint(message), `${message.id}_output`, message.output),
      (output) =>
        "truncated" in output
          ? { ...message, output: output.text, truncated: output.truncated, content: output.content }
          : message,
    )
  return Effect.succeed(message)
}

function projectMessageParts(
  database: DatabaseService,
  sessionID: string,
  message: (typeof SessionMessage.Message)["Encoded"],
) {
  if (message.type !== "assistant") return Effect.succeed([])
  return Effect.forEach(message.content, (part, ordinal) =>
    Effect.gen(function* () {
      const revision = fingerprint(part)
      const row = yield* projectPart(database, sessionID, message.id, revision, part)
      return {
        key: JSON.stringify([message.id, part.type, part.id]),
        row: { ...row, messageID: message.id, ordinal },
        revision,
      }
    }),
  )
}

function refreshInputs(database: DatabaseService, sessionID: string, txid: string) {
  return Effect.gen(function* () {
    const inputs = yield* database
      .select()
      .from(SessionInputTable)
      .where(and(eq(SessionInputTable.session_id, Session.ID.make(sessionID)), isNull(SessionInputTable.promoted_seq)))
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
  })
}

function refreshCompactionStart(database: DatabaseService, event: typeof SessionEvent.Compaction.Started.Type) {
  return Effect.gen(function* () {
    const txid = (yield* MutationTxid) ?? crypto.randomUUID()
    yield* refreshSession(database, event.data.sessionID, false, txid)
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
  return Effect.gen(function* () {
    const txid = (yield* MutationTxid) ?? crypto.randomUUID()
    yield* removeScopeRow(database, "messages", input.sessionID, input.messageID, txid)
    yield* replaceMessageParts(database, input.sessionID, input.messageID, [], txid)
  }).pipe(Effect.orDie)
}

export function refreshTodos(database: DatabaseService, sessionID: string, txid: string) {
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
        row: {
          id: todo.id,
          content: todo.content,
          status: todo.status,
          priority: todo.priority,
          position: todo.position,
        },
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
        ...projects.flatMap((project) => (project.directory ? [{ directory: project.directory }] : [])),
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
    if (part.state.status === "pending") {
      const input = yield* projectText(
        database,
        sessionID,
        revision,
        `${messageID}_${part.id}_tool_input`,
        part.state.input,
      )
      return {
        ...part,
        state: {
          ...part.state,
          input: input.text,
          ...("truncated" in input ? { truncated: input.truncated, content: input.content } : {}),
        },
      }
    }
    const input = yield* projectJson(
      database,
      sessionID,
      revision,
      `${messageID}_${part.id}_tool_input`,
      part.state.input,
    )
    const structured = yield* projectJson(
      database,
      sessionID,
      revision,
      `${messageID}_${part.id}_tool_structured`,
      part.state.structured,
    )
    const result =
      !("result" in part.state) || part.state.result === undefined
        ? undefined
        : yield* projectJson(
            database,
            sessionID,
            revision,
            `${messageID}_${part.id}_tool_result`,
            part.state.result,
          )
    const content = yield* Effect.forEach(part.state.content, (item, index) =>
      Effect.gen(function* () {
        if (item.type === "file") {
          const uri = yield* projectText(
            database,
            sessionID,
            revision,
            `${messageID}_${part.id}_tool_${index}_file`,
            item.uri,
          )
          return {
            ...item,
            uri: uri.text,
            ...("truncated" in uri ? { truncated: true, content: uri.content } : {}),
          }
        }
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
    return { ...part, state: { ...part.state, input, structured, content, ...(result === undefined ? {} : { result }) } }
  })
}

function projectJson(database: DatabaseService, sessionID: string, revision: string, id: string, value: unknown) {
  return Effect.gen(function* () {
    const text = JSON.stringify(value)
    const projected = preview(text)
    if (!projected.truncated) return value
    yield* database.run(sql`
      INSERT OR REPLACE INTO full_content (id, session_id, revision, content, created_at)
      VALUES (${id}, ${sessionID}, ${revision}, ${text}, ${Date.now()})
    `)
    return { truncated: true, content: { id, revision, bytes: projected.totalBytes } }
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
          INSERT OR IGNORE INTO full_content (id, session_id, revision, content, created_at)
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
    const existing = yield* database.all<{ row_key: string; row: string; row_revision: string }>(sql`
      SELECT row_key, row, row_revision FROM collection_row
      WHERE collection = ${collection} AND scope_key = ${scopeKey}
    `)
    yield* replaceRows(database, collection, scopeKey, rows, existing, txid, deleteOmitted)
  })
}

function replaceScopeRow(
  database: DatabaseService,
  collection: string,
  scopeKey: string,
  row: { key: string; row: unknown; revision: string },
  txid: string,
) {
  return Effect.gen(function* () {
    const existing = yield* database.all<{ row_key: string; row: string; row_revision: string }>(sql`
      SELECT row_key, row, row_revision FROM collection_row
      WHERE collection = ${collection} AND scope_key = ${scopeKey} AND row_key = ${row.key}
    `)
    yield* replaceRows(database, collection, scopeKey, [row], existing, txid, false)
  })
}

function replaceMessageParts(
  database: DatabaseService,
  sessionID: string,
  messageID: string,
  rows: ReadonlyArray<{ key: string; row: unknown; revision: string }>,
  txid: string,
) {
  return Effect.gen(function* () {
    const prefix = `${JSON.stringify([messageID]).slice(0, -1)},`
    const existing = yield* database.all<{ row_key: string; row: string; row_revision: string }>(sql`
      SELECT row_key, row, row_revision FROM collection_row
      WHERE collection = 'parts' AND scope_key = ${sessionID}
        AND row_key >= ${prefix} AND row_key < ${`${prefix}\uffff`}
    `)
    yield* replaceRows(database, "parts", sessionID, rows, existing, txid, true)
  })
}

function replaceRows(
  database: DatabaseService,
  collection: string,
  scopeKey: string,
  rows: ReadonlyArray<{ key: string; row: unknown; revision: string }>,
  existing: ReadonlyArray<{ row_key: string; row: string; row_revision: string }>,
  txid: string,
  deleteOmitted: boolean,
) {
  return Effect.gen(function* () {
    const runtimeID =
      (yield* database.get<{ runtime_id: string }>(sql`SELECT runtime_id FROM collection_feed WHERE id = 1`))
        ?.runtime_id ?? (yield* Effect.die("collection_feed is missing"))
    const existingByKey = new Map(existing.map((row) => [row.row_key, row]))
    const incoming = new Set(rows.map((row) => row.key))
    for (const row of rows) {
      const encoded = JSON.stringify(row.row)
      if (!fitsCollectionRow(collection, scopeKey, row))
        yield* Effect.die("Collection row exceeds stream frame limit")
      const stored = existingByKey.get(row.key)
      if (stored?.row === encoded && stored.row_revision === row.revision) continue
      yield* database.run(sql`
        INSERT INTO collection_row (collection, scope_key, row_key, row, row_revision)
        VALUES (${collection}, ${scopeKey}, ${row.key}, ${encoded}, ${row.revision})
        ON CONFLICT (collection, scope_key, row_key)
        DO UPDATE SET row = excluded.row, row_revision = excluded.row_revision
      `)
      yield* appendChange(database, runtimeID, {
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
        yield* appendChange(database, runtimeID, {
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
    const runtimeID =
      (yield* database.get<{ runtime_id: string }>(sql`SELECT runtime_id FROM collection_feed WHERE id = 1`))
        ?.runtime_id ?? (yield* Effect.die("collection_feed is missing"))
    yield* database.run(sql`
      DELETE FROM collection_row
      WHERE collection = ${collection} AND scope_key = ${scopeKey} AND row_key = ${rowKey}
    `)
    yield* appendChange(database, runtimeID, {
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
