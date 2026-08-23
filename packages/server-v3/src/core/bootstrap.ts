import { SessionMessage } from "@hena/schema/session-message"
import { PromptInput } from "@hena/schema/prompt-input"
import { Schema } from "effect"
import { preview } from "../storage/content"
import { fingerprint } from "../storage/fingerprint"
import type { SyncDatabase } from "../storage/database"
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

type SessionRow = {
  id: string
  project_id: string
  workspace_id: string | null
  parent_id: string | null
  directory: string
  path: string | null
  title: string
  agent: string | null
  model: string | null
  cost: number
  tokens_input: number
  tokens_output: number
  tokens_reasoning: number
  tokens_cache_read: number
  tokens_cache_write: number
  revert: string | null
  time_created: number
  time_updated: number
  time_archived: number | null
  queue_revision: number
}

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

export function bootstrapCollections(database: SyncDatabase) {
  const projects = database.raw.query<ProjectRow, []>("SELECT * FROM project ORDER BY id").all()
  database.collections.hydrate(
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
  database.collections.hydrate(
    "sessions",
    "",
    sessions.map((session) => ({
      key: session.id,
      revision: String(session.time_updated),
      row: sessionRow(session),
    })),
  )
  const messages = database.raw
    .query<MessageRow, []>("SELECT id, session_id, type, data FROM session_message ORDER BY seq")
    .all()
  const inputs = database.raw.query<InputRow, []>("SELECT * FROM session_input ORDER BY admitted_seq").all()
  const todos = database.raw
    .query<TodoRow, []>("SELECT id, session_id, content, status, priority, time_updated FROM todo ORDER BY position")
    .all()
  sessions.forEach((session) =>
    hydrateSessionCollections(
      database,
      session.id,
      messages.filter((message) => message.session_id === session.id),
      inputs.filter((input) => input.session_id === session.id),
      todos.filter((todo) => todo.session_id === session.id),
    ),
  )
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
  database.collections.hydrate(
    "locations",
    "",
    Array.from(locations, ([key, row]) => ({ key, row, revision: "1" })),
  )
}

function hydrateSessionCollections(
  database: SyncDatabase,
  sessionID: string,
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
        row: message.type === "assistant" ? { ...message, content: undefined } : message,
        revision,
      },
      parts:
        message.type === "assistant"
          ? message.content.map((part) => ({
              key: JSON.stringify([message.id, part.type, part.id]),
              row: { ...projectPart(database, sessionID, message.id, revision, part), messageID: message.id },
              revision,
            }))
          : [],
    }
  })
  database.collections.hydrate(
    "messages",
    sessionID,
    projected.map((item) => item.message),
  )
  database.collections.hydrate(
    "parts",
    sessionID,
    projected.flatMap((item) => item.parts),
  )
  database.collections.hydrate(
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
        timeCreated: input.time_created,
      }
      return { key: input.id, row, revision: fingerprint(row) }
    }),
  )
  database.collections.hydrate(
    "todos",
    sessionID,
    todos.map((todo) => ({
      key: todo.id,
      row: { id: todo.id, content: todo.content, status: todo.status, priority: todo.priority },
      revision: String(todo.time_updated),
    })),
  )
}

function projectPrompt(
  database: SyncDatabase,
  sessionID: string,
  inputID: string,
  prompt: PromptInput.Prompt,
) {
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
  await Promise.all(
    database.collections.snapshot("locations", "").rows.map(async (location) => {
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
}

function sessionRow(session: SessionRow) {
  return {
    id: session.id,
    projectID: session.project_id,
    parentID: session.parent_id ?? undefined,
    title: session.title,
    agent: session.agent ?? undefined,
    model: parseJson(session.model),
    cost: session.cost,
    tokens: {
      input: session.tokens_input,
      output: session.tokens_output,
      reasoning: session.tokens_reasoning,
      cache: { read: session.tokens_cache_read, write: session.tokens_cache_write },
    },
    location: { directory: session.directory, ...(session.workspace_id ? { workspaceID: session.workspace_id } : {}) },
    subpath: session.path ?? undefined,
    revert: parseJson(session.revert),
    queueRevision: session.queue_revision,
    time: {
      created: session.time_created,
      updated: session.time_updated,
      archived: session.time_archived ?? undefined,
    },
  }
}

function parseJson(input: string | null) {
  return input === null ? undefined : JSON.parse(input)
}
