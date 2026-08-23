import { SessionMessage } from "@hena/schema/session-message"
import { Session } from "@hena/schema/session"
import { PromptInput } from "@hena/schema/prompt-input"
import { fromRow, type SessionInfoRow } from "@hena/core/session/info"
import { Schema } from "effect"
import { preview } from "../storage/content"
import { fingerprint } from "../storage/fingerprint"
import type { SyncDatabase } from "../storage/database"
import { SessionCollections } from "../collection/manifest"
import type { CoreDomain } from "./domain"
import type { OnlineRequestStore } from "./online-requests"

type ProjectRow = {
  id: string
  worktree: string
  vcs: string | null
  name: string | null
  icon_url: string | null
  icon_url_override: string | null
  icon_color: string | null
  time_created: number
  time_updated: number
  time_initialized: number | null
  sandboxes: string
  commands: string | null
}

type SessionRow = Omit<SessionInfoRow, "model" | "revert"> & { model: string | null; revert: string | null }

type MessageRow = {
  id: string
  session_id: string
  type: string
  data: string
}

type InputRow = {
  id: string
  session_id: string
  prompt: string
  delivery: string
  admitted_seq: number
  promoted_seq: number | null
  queue_position: number
  time_created: number
}

type TodoRow = {
  id: string
  session_id: string
  content: string
  status: string
  priority: string
  time_updated: number
}

const decodeMessage = Schema.decodeUnknownSync(SessionMessage.Message)
const encodeMessage = Schema.encodeSync(SessionMessage.Message)
const encodeSession = Schema.encodeUnknownSync(Session.Info)

export function bootstrapCollections(database: SyncDatabase) {
  database.raw.exec(`UPDATE todo SET id = 'todo_' || lower(hex(randomblob(16))) WHERE id IS NULL`)
  const projects = database.raw.query<ProjectRow, []>("SELECT * FROM project ORDER BY id").all()
  const projectsChanged = database.collections.hydrate(
    "projects",
    "",
    projects.map((project) => ({
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
        commands: parseJson(project.commands),
        sandboxes: parseJson(project.sandboxes) ?? [],
        time: {
          created: project.time_created,
          updated: project.time_updated,
          initialized: project.time_initialized ?? undefined,
        },
      },
    })),
  )

  const sessions = database.raw.query<SessionRow, []>("SELECT * FROM session ORDER BY id").all()
  const sessionsChanged = database.collections.hydrate(
    "sessions",
    "",
    sessions.map((session) => {
      const row = sessionRow(session)
      return { key: session.id, revision: fingerprint(row), row }
    }),
  )
  const messages = database.raw
    .query<MessageRow, []>("SELECT id, session_id, type, data FROM session_message ORDER BY seq")
    .all()
  const inputs = database.raw
    .query<InputRow, []>("SELECT * FROM session_input WHERE promoted_seq IS NULL ORDER BY admitted_seq")
    .all()
  const todos = database.raw
    .query<TodoRow, []>("SELECT id, session_id, content, status, priority, time_updated FROM todo ORDER BY position")
    .all()
  const messagesBySession = Map.groupBy(messages, (message) => message.session_id)
  const inputsBySession = Map.groupBy(inputs, (input) => input.session_id)
  const todosBySession = Map.groupBy(todos, (todo) => todo.session_id)
  const sessionCollectionsChanged = sessions.map((session) =>
    hydrateSessionCollections(
      database,
      session.id,
      session.queue_revision,
      messagesBySession.get(session.id) ?? [],
      inputsBySession.get(session.id) ?? [],
      todosBySession.get(session.id) ?? [],
    ),
  )
  const sessionIDs = new Set<string>(sessions.map((session) => session.id))
  const staleSessionIDs = database.raw
    .query<{ session_id: string }, []>(
      `
    SELECT scope_key AS session_id FROM collection_row
    WHERE collection IN ('messages', 'parts', 'sessionInputs', 'todos')
    UNION SELECT session_id FROM full_content
  `,
    )
    .all()
    .map((row) => row.session_id)
    .filter((sessionID) => !sessionIDs.has(sessionID))
  const staleSessionCollectionsChanged = staleSessionIDs.flatMap((sessionID) => {
    database.raw.query("DELETE FROM full_content WHERE session_id = ?").run(sessionID)
    return SessionCollections.map((collection) => database.collections.hydrate(collection, sessionID, []))
  })
  const locations = new Map(
    projects.map((project) => {
      const ref = { directory: project.worktree }
      return [JSON.stringify(ref), ref]
    }),
  )
  sessions.forEach((session) => {
    const ref = { directory: session.directory, ...(session.workspace_id ? { workspaceID: session.workspace_id } : {}) }
    locations.set(JSON.stringify(ref), ref)
  })
  const locationsChanged = database.collections.hydrate(
    "locations",
    "",
    Array.from(locations, ([key, row]) => ({ key, row, revision: "1" })),
  )
  return (
    projectsChanged ||
    sessionsChanged ||
    locationsChanged ||
    sessionCollectionsChanged.some(Boolean) ||
    staleSessionCollectionsChanged.some(Boolean)
  )
}

function hydrateSessionCollections(
  database: SyncDatabase,
  sessionID: string,
  queueRevision: number,
  storedMessages: ReadonlyArray<MessageRow>,
  inputs: ReadonlyArray<InputRow>,
  todos: ReadonlyArray<TodoRow>,
) {
  const projected = storedMessages.map((stored) => {
    const message = encodeMessage(decodeMessage({ ...JSON.parse(stored.data), id: stored.id, type: stored.type }))
    const revision = fingerprint(message)
    return {
      message: {
        key: message.id,
        row:
          message.type === "assistant"
            ? { ...message, content: undefined }
            : message.type === "user"
              ? {
                  ...message,
                  ...projectPrompt(database, sessionID, message.id, {
                    text: message.text,
                    files: message.files,
                    agents: message.agents,
                  }),
                }
              : message,
        revision,
      },
      parts:
        message.type === "assistant"
          ? message.content.map((part) => {
              const partRevision = fingerprint(part)
              return {
                key: JSON.stringify([message.id, part.type, part.id]),
                row: { ...projectPart(database, sessionID, message.id, partRevision, part), messageID: message.id },
                revision: partRevision,
              }
            })
          : [],
    }
  })
  const messagesChanged = database.collections.hydrate(
    "messages",
    sessionID,
    projected.map((item) => item.message),
  )
  const partsChanged = database.collections.hydrate(
    "parts",
    sessionID,
    projected.flatMap((item) => item.parts),
  )
  const inputsChanged = database.collections.hydrate(
    "sessionInputs",
    sessionID,
    inputs.map((input) => {
      const prompt = projectPrompt(database, sessionID, input.id, JSON.parse(input.prompt))
      const row = {
        id: input.id,
        sessionID: input.session_id,
        prompt,
        delivery: input.delivery,
        admittedSeq: input.admitted_seq,
        promotedSeq: input.promoted_seq ?? undefined,
        queuePosition: input.queue_position,
        queueRevision,
        timeCreated: input.time_created,
      }
      return { key: input.id, row, revision: fingerprint(row) }
    }),
  )
  const todosChanged = database.collections.hydrate(
    "todos",
    sessionID,
    todos.map((todo) => ({
      key: todo.id,
      row: { id: todo.id, content: todo.content, status: todo.status, priority: todo.priority },
      revision: String(todo.time_updated),
    })),
  )
  return messagesChanged || partsChanged || inputsChanged || todosChanged
}

function projectPrompt(database: SyncDatabase, sessionID: string, inputID: string, prompt: PromptInput.Prompt) {
  if (!prompt.files) return prompt
  const revision = fingerprint(prompt)
  return {
    ...prompt,
    files: prompt.files.map((file, index) => {
      const projected = preview(file.uri)
      if (!projected.truncated) return file
      const id = `${inputID}_attachment_${index}`
      database.content.put({ id, sessionID, revision, text: file.uri })
      return {
        ...file,
        uri: projected.text,
        truncated: true as const,
        content: { id, revision, bytes: projected.totalBytes },
      }
    }),
  }
}

function projectPart(
  database: SyncDatabase,
  sessionID: string,
  messageID: string,
  revision: string,
  part: (typeof SessionMessage.AssistantContent)["Encoded"],
) {
  if (part.type === "text" || part.type === "reasoning")
    return { ...part, ...projectText(database, sessionID, revision, `${messageID}_${part.id}_text`, part.text) }
  if (part.state.status === "pending") return part
  return {
    ...part,
    state: {
      ...part.state,
      content: part.state.content.map((item, index) =>
        item.type === "file"
          ? item
          : {
              ...item,
              ...projectText(database, sessionID, revision, `${messageID}_${part.id}_tool_${index}`, item.text),
            },
      ),
    },
  }
}

function projectText(database: SyncDatabase, sessionID: string, revision: string, id: string, text: string) {
  const projected = preview(text)
  if (!projected.truncated) return { text }
  database.content.put({ id, sessionID, revision, text })
  return {
    text: projected.text,
    truncated: true as const,
    content: { id, revision, bytes: projected.totalBytes, lines: projected.totalLines },
  }
}

export async function bootstrapLocationCollections(
  database: SyncDatabase,
  domain: CoreDomain,
  online: OnlineRequestStore,
) {
  const locations = database.collections.snapshot("locations", "").rows
  online.retainCatalogs(locations.map((location) => location.key))
  const results = await Promise.allSettled(
    locations.map(async (location) => {
      const ref = location.row as { directory: string; workspaceID?: string }
      const catalog = await domain.catalog(ref)
      online.replace(
        "agents",
        location.key,
        catalog.agents.map((agent) => ({
          key: agent.id,
          row: {
            id: agent.id,
            model: agent.model,
            description: agent.description,
            mode: agent.mode,
            hidden: agent.hidden,
            color: agent.color,
            steps: agent.steps,
            permissions: agent.permissions,
          },
        })),
      )
      online.replace(
        "models",
        location.key,
        catalog.models.map((model) => ({
          key: JSON.stringify([model.providerID, model.id]),
          row: {
            id: model.id,
            providerID: model.providerID,
            family: model.family,
            name: model.name,
            capabilities: model.capabilities,
            variants: model.variants.map((variant) => ({ id: variant.id })),
            time: model.time,
            cost: model.cost,
            status: model.status,
            enabled: model.enabled,
            limit: model.limit,
          },
        })),
      )
      online.replace(
        "providers",
        location.key,
        catalog.providers.map((provider) => ({
          key: provider.id,
          row: {
            id: provider.id,
            integrationID: provider.integrationID,
            name: provider.name,
            disabled: provider.disabled,
          },
        })),
      )
    }),
  )
  const rejected = results.find((result) => result.status === "rejected")
  if (rejected) throw rejected.reason
}

export function createLocationCollectionRefresh(
  database: SyncDatabase,
  domain: CoreDomain,
  online: OnlineRequestStore,
  onError: (cause: unknown) => void = () => {},
) {
  let pending = Promise.resolve()
  return {
    run() {
      const current = pending.then(() => bootstrapLocationCollections(database, domain, online))
      pending = current.catch(onError)
      return current
    },
    idle: () => pending,
  }
}

function sessionRow(session: SessionRow) {
  return encodeSession(fromRow({ ...session, model: parseJson(session.model), revert: parseJson(session.revert) }))
}

function parseJson(input: string | null) {
  return input === null ? undefined : JSON.parse(input)
}
