import { useLiveQuery } from "@tanstack/react-db"
import { useQuery } from "@tanstack/react-query"
import { useSyncExternalStore } from "react"
import type { ReturnTypeOfAgent } from "./types"
import type {
  Agent,
  AssistantPart,
  Model,
  PermissionRequest,
  Project,
  ProjectNotification,
  Provider,
  QuestionRequest,
  Session,
  SessionMessage,
  Todo,
  FileNode,
} from "@/lib/types"
import { createConnectionStore, type DeltaIdentity } from "@/connection/store"
import { getMutationStateVersion, isMessagePending, subscribeMutationState } from "@/mutations/session"
import { useSeenWatermarks, wasSeenAfter } from "@/local-state/seen"

const emptyStore = createConnectionStore()
type VisibleDelta = DeltaIdentity & { partKind: "text" | "reasoning" }

export function useProjects(agent: ReturnTypeOfAgent | undefined) {
  return useRows(agent, "projects", "")
    .map((row) => projectView(row, agent?.url ?? ""))
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

export function useCollectionReady(agent: ReturnTypeOfAgent | undefined, collection: string, scopeKey = "") {
  return useSyncExternalStore(
    agent ? agent.store.subscribe : emptySubscribe,
    () => agent?.store.isReady(collection, scopeKey) ?? false,
    () => false,
  )
}

export function useFileTree(agent: ReturnTypeOfAgent | undefined, location: { directory: string; workspaceID?: string } | undefined, path?: string) {
  return useQuery({
    queryKey: [agent?.url, "fs.list", location?.directory, location?.workspaceID, path],
    enabled: Boolean(agent && location),
    queryFn: ({ signal }) => loadFileDirectory(agent!, location!, path, signal),
  })
}

export function useFileContent(agent: ReturnTypeOfAgent | undefined, location: { directory: string; workspaceID?: string } | undefined, path: string | undefined) {
  return useQuery({
    queryKey: [agent?.url, "fs.read", location?.directory, location?.workspaceID, path],
    enabled: Boolean(agent && location && path),
    queryFn: async () => {
      const response = await agent!.client.api.fs.read.$get({ query: { directory: location!.directory, workspaceID: location!.workspaceID, path: path!, limit: String(256 * 1024) } })
      if (!response.ok) throw new Error("Could not read file")
      return response.json()
    },
  })
}

export async function loadFileMatches(agent: ReturnTypeOfAgent, location: { directory: string; workspaceID?: string }, query: string, signal?: AbortSignal) {
  const response = await agent.client.api.fs.find.$get({
    query: { directory: location.directory, workspaceID: location.workspaceID, query, type: "file", limit: "20" },
  }, { init: { signal } })
  if (!response.ok) throw new Error("Could not search files")
  return (await response.json()).data.map((entry) => entry.path)
}

export async function loadFileDirectory(agent: ReturnTypeOfAgent, location: { directory: string; workspaceID?: string }, path?: string, signal?: AbortSignal) {
  const response = await agent.client.api.fs.list.$get({
    query: { directory: location.directory, workspaceID: location.workspaceID, path, limit: "1000" },
  }, { init: { signal } })
  if (!response.ok) throw new Error("Could not list files")
  return (await response.json()).data.map((entry): FileNode => ({ path: entry.path.replace(/[\\/]$/, ""), type: entry.type }))
}

export function useProject(agent: ReturnTypeOfAgent | undefined, id: string | undefined) {
  return useProjects(agent).find((project) => project.id === id)
}

export function useSessions(agent: ReturnTypeOfAgent | undefined, projectId?: string) {
  useSeenWatermarks(agent?.url)
  const permissions = useRows(agent, "permissions", "")
  const questions = useRows(agent, "questions", "")
  const sessions = useRows(agent, "sessions", "").map((row) => sessionView(row, permissions, questions, agent?.url ?? ""))
  const visible = sessions.filter((session) => !session.archived && (!projectId || session.projectId === projectId))
  return visible.sort((left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id))
}

export function useSession(agent: ReturnTypeOfAgent | undefined, id: string | undefined) {
  return useSessions(agent).find((session) => session.id === id)
}

export function useSessionLocation(agent: ReturnTypeOfAgent | undefined, id: string | undefined) {
  const row = useRows(agent, "sessions", "").find((session) => string(session.id) === id)
  const location = record(row?.location)
  return typeof location.directory === "string"
    ? { directory: location.directory, ...(typeof location.workspaceID === "string" ? { workspaceID: location.workspaceID } : {}) }
    : undefined
}

export function useMessages(agent: ReturnTypeOfAgent | undefined, sessionId: string) {
  const messagesReady = useCollectionReady(agent, "messages", sessionId)
  const partsReady = useCollectionReady(agent, "parts", sessionId)
  const ready = messagesReady && partsReady
  useSyncExternalStore(subscribeMutationState, getMutationStateVersion, getMutationStateVersion)
  useSyncExternalStore(
    agent ? (listener) => agent.store.subscribeDeltaIdentities(sessionId, listener) : emptySubscribe,
    () => agent?.store.deltaIdentityRevision(sessionId) ?? 0,
    () => 0,
  )
  useSyncExternalStore(
    agent ? (listener) => agent.localMessages.subscribe(sessionId, listener) : emptySubscribe,
    () => agent?.localMessages.revision(sessionId) ?? 0,
    () => 0,
  )
  const messages = useRows(agent, "messages", sessionId)
  const parts = useRows(agent, "parts", sessionId)
  const localRows = agent?.localMessages.rows(sessionId) ?? []
  const localIDs = new Set(localRows.map((message) => string(message.id)))
  const deltas = (agent?.store.deltaIdentities(sessionId) ?? []).filter(isVisibleDelta)
  const projected = (ready ? messages : messages.filter((message) => localIDs.has(string(message.id))))
    .map((message) => messageView(agent, sessionId, message, parts, deltas))
  const known = new Set(projected.map((message) => message.id))
  const local = localRows.flatMap((message) => known.has(string(message.id))
    ? []
    : [messageView(agent, sessionId, message, parts, deltas)])
  const provisional = deltas
    .filter((delta) => !known.has(delta.messageId))
    .reduce<Extract<SessionMessage, { role: "assistant" }>[]>((result, delta) => {
      const message = result.find((item) => item.id === delta.messageId)
      if (message) message.parts.push(deltaPartView(agent!, delta))
      if (!message) result.push({ id: delta.messageId, sessionId, createdAt: Number.MAX_SAFE_INTEGER, role: "assistant", parts: [deltaPartView(agent!, delta)] })
      return result
    }, [])
  return {
    messages: [...projected, ...local, ...provisional]
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id)),
    ready,
  }
}

export function useTodos(agent: ReturnTypeOfAgent | undefined, sessionId: string) {
  return useRows(agent, "todos", sessionId).sort((left, right) => number(left.position) - number(right.position)).map(todoView)
}

export function usePermission(agent: ReturnTypeOfAgent | undefined, sessionId: string) {
  const row = useRows(agent, "permissions", "")
    .filter((item) => string(item.sessionID) === sessionId)
    .sort((left, right) => number(record(left.time).created) - number(record(right.time).created))[0]
  return row && permissionView(row)
}

export function useQuestion(agent: ReturnTypeOfAgent | undefined, sessionId: string) {
  const row = useRows(agent, "questions", "")
    .filter((item) => string(item.sessionID) === sessionId)
    .sort((left, right) => number(record(left.time).created) - number(record(right.time).created))[0]
  return row && questionView(row)
}

export function usePendingRequest(agent: ReturnTypeOfAgent | undefined, collection: "permissions" | "questions", sessionId: string) {
  return useRows(agent, collection, "").find((item) => string(item.sessionID) === sessionId)
}

export function useQueuedInputs(agent: ReturnTypeOfAgent | undefined, sessionId: string) {
  const session = useRows(agent, "sessions", "").find((item) => string(item.id) === sessionId)
  return {
    revision: number(session?.queueRevision),
    items: useRows(agent, "sessionInputs", sessionId)
      .filter((item) => item.promotedSeq === undefined)
      .sort((left, right) => number(left.queuePosition) - number(right.queuePosition))
      .map((item) => ({ id: string(item.id), text: string(record(item.prompt).text), position: number(item.queuePosition) })),
  }
}

export function useCatalog(agent: ReturnTypeOfAgent | undefined, location: { directory: string; workspaceID?: string } | undefined) {
  const scope = location ? JSON.stringify(location) : "missing"
  const agents = useRows(agent, "agents", scope).map(agentView)
  const models = useRows(agent, "models", scope).map(modelView)
  const providers = useRows(agent, "providers", scope).map(providerView)
  return {
    agents: agents.filter((item) => item.id),
    models: models.filter((item) => item.id),
    providers: providers.filter((item) => item.id),
  }
}

// The `agents`/`models`/`providers` collection scopes `useCatalog` reads only exist once a
// directory is a known location (see server-v3's collection-projector `reconcileLocations`), so
// they're empty for a directory that has never had a session. This fetches the same catalog
// directly instead, for screens that need it *before* that first session exists.
export function useLocationCatalog(
  agent: ReturnTypeOfAgent | undefined,
  location: { directory: string; workspaceID?: string } | undefined,
) {
  return useQuery({
    queryKey: [agent?.url, "catalog", location?.directory, location?.workspaceID],
    enabled: Boolean(agent && location),
    queryFn: async () => {
      const response = await agent!.client.api.catalog.$get({
        query: { directory: location!.directory, workspaceID: location!.workspaceID },
      })
      if (!response.ok) throw new Error("Could not load the catalog")
      const data = await response.json()
      const agents = data.agents.map(agentView)
      const models = data.models.map(modelView)
      const providers = data.providers.map(providerView)
      return {
        agents: agents.filter((item) => item.id),
        models: models.filter((item) => item.id),
        providers: providers.filter((item) => item.id),
      }
    },
  })
}

export function useSettings(agent: ReturnTypeOfAgent | undefined, scope: string) {
  return Object.fromEntries(useRows(agent, "settings", scope).map((item) => [string(item.key), item.value]))
}

export function projectNotification(projectId: string, sessions: Session[]): ProjectNotification {
  const scoped = sessions.filter((session) => session.projectId === projectId)
  const working = scoped.some((session) => session.status === "working")
  if (scoped.some((session) => session.status === "permission" || session.status === "question")) return { kind: "permission", working }
  if (scoped.some((session) => session.status === "error")) return { kind: "error", working }
  if (scoped.some((session) => session.unread)) return { kind: "unread", working }
  return { kind: "none", working }
}

function useRows(agent: ReturnTypeOfAgent | undefined, collection: string, scope: string) {
  const source = (agent?.store ?? emptyStore).collection(collection, scope)
  const result = useLiveQuery(source)
  return (result.data ?? []).map((item) => item.row)
}

function projectView(row: Record<string, unknown>, connectionId: string): Project {
  const time = record(row.time)
  const icon = record(row.icon)
  const worktree = string(row.worktree)
  return {
    id: string(row.id),
    connectionId,
    name: string(row.name) || worktree.split(/[\\/]/).filter(Boolean).at(-1) || worktree,
    path: worktree,
    color: avatarColor(icon.color),
    updatedAt: number(time.updated),
  }
}

function sessionView(row: Record<string, unknown>, permissions: Record<string, unknown>[], questions: Record<string, unknown>[], connectionId: string): Session {
  const time = record(row.time)
  const id = string(row.id)
  return {
    id,
    projectId: string(row.projectID),
    connectionId,
    title: string(row.title) || "Untitled session",
    status: permissions.some((item) => string(item.sessionID) === id)
      ? "permission"
      : questions.some((item) => string(item.sessionID) === id)
        ? "question"
        : row.working === true ? "working" : "idle",
    unread: connectionId ? !wasSeenAfter(connectionId, id, number(time.updated)) : false,
    createdAt: number(time.created),
    updatedAt: number(time.updated),
    archived: typeof time.archived === "number",
    shared: false,
    parentId: optionalString(row.parentID),
    agentId: optionalString(row.agent),
    model: typeof record(row.model).id === "string" && typeof record(row.model).providerID === "string"
      ? { id: string(record(row.model).id), providerId: string(record(row.model).providerID) }
      : undefined,
  }
}

function messageView(agent: ReturnTypeOfAgent | undefined, sessionId: string, row: Record<string, unknown>, parts: Record<string, unknown>[], deltas: VisibleDelta[]): SessionMessage {
  const type = string(row.type)
  const base = {
    id: string(row.id),
    sessionId,
    createdAt: number(record(row.time).created),
    pending: isMessagePending(string(row.id)),
  }
  if (type === "user") {
    const files = array(row.files).map((file) => string(record(file).name || record(file).uri))
    return { ...base, role: "user", text: string(row.text), files: files.filter(Boolean) }
  }
  if (type === "assistant") {
    const persisted = parts.filter((part) => string(part.messageID) === base.id).sort((left, right) => number(left.ordinal) - number(right.ordinal)).map((part) => partView(agent, base.sessionId, base.id, part))
    const known = new Set(persisted.map((part) => `${part.kind}\u0000${part.id}`))
    return {
      ...base,
      role: "assistant",
      parts: [...persisted, ...deltas.flatMap((delta) => delta.messageId === base.id && !known.has(`${delta.partKind}\u0000${delta.partId}`) ? [deltaPartView(agent!, delta)] : [])],
      agent: optionalString(row.agent),
      model: optionalString(record(row.model).id),
    }
  }
  if (type === "compaction") return { ...base, role: "compaction", summary: string(row.summary), final: Boolean(record(row.time).completed) }
  if (type === "shell") return { ...base, role: "shell", command: string(row.command), output: string(row.output) }
  if (type === "agent-switched") return { ...base, role: "agent-switched", from: string(row.from), to: string(row.agent || row.to) }
  if (type === "model-switched") return { ...base, role: "model-switched", from: string(record(row.from).id || row.from), to: string(record(row.model).id || row.to) }
  if (type === "synthetic") return { ...base, role: "synthetic", text: string(row.text) }
  if (type === "system") return { ...base, role: "system", text: string(row.text) }
  return { ...base, role: "unknown", type, summary: string(row.text || row.summary) || "Unsupported message" }
}

function partView(agent: ReturnTypeOfAgent | undefined, sessionId: string, messageId: string, row: Record<string, unknown>): AssistantPart {
  const type = string(row.type)
  if (type === "text") return {
    id: string(row.id),
    kind: "text",
    text: string(row.text),
    live: liveText(agent, { sessionId, messageId, partId: string(row.id), partKind: type }),
    content: contentReference(agent, sessionId, row.content),
  }
  if (type === "reasoning") return {
    id: string(row.id),
    kind: "reasoning",
    text: string(row.text),
    live: liveText(agent, { sessionId, messageId, partId: string(row.id), partKind: type }),
  }
  if (type !== "tool") return { id: string(row.id), kind: "unknown" as const, type, summary: "Unsupported assistant part" }
  const state = record(row.state)
  const status = toolStatus(state.status)
  return {
    id: string(row.id),
    kind: "tool" as const,
    tool: string(row.tool),
    status,
    input: typeof state.input === "string" ? state.input : JSON.stringify(state.input ?? {}),
    output: state.result === undefined ? undefined : typeof state.result === "string" ? state.result : JSON.stringify(state.result),
    liveInput: liveText(agent, { sessionId, messageId, partId: string(row.id), partKind: "tool-input" }),
    outputContent: contentReference(agent, sessionId, record(state.result).content),
  }
}

function todoView(row: Record<string, unknown>): Todo {
  const status = string(row.status)
  return {
    id: string(row.id),
    sessionId: string(row.sessionID),
    text: string(row.content),
    status: status === "in_progress" || status === "completed" || status === "cancelled" ? status : "pending",
  }
}

function permissionView(row: Record<string, unknown>): PermissionRequest {
  return {
    id: string(row.id),
    sessionId: string(row.sessionID),
    title: string(row.action || row.permission || row.title) || "Permission required",
    description: string(row.description || row.pattern || row.message),
    createdAt: number(record(row.time).created),
  }
}

function questionView(row: Record<string, unknown>): QuestionRequest {
  const questions = array(row.questions)
  const prompt = record(questions[0] ?? row)
  return {
    id: string(row.id),
    sessionId: string(row.sessionID),
    prompt: string(prompt.question || prompt.prompt || row.prompt) || "Choose an answer",
    choices: array(prompt.options || row.options).map((option, index) => ({ id: String(index), label: string(record(option).label || option) })),
    createdAt: number(record(row.time).created),
  }
}

function agentView(row: Record<string, unknown>): Agent {
  return { id: string(row.id), name: string(row.id), description: string(row.description) }
}

function modelView(row: Record<string, unknown>): Model {
  return { id: string(row.id), providerId: string(row.providerID), name: string(row.name) || string(row.id), contextWindow: number(record(row.limit).context) }
}

function providerView(row: Record<string, unknown>): Provider {
  return { id: string(row.id), name: string(row.name) || string(row.id), connected: row.connected === true }
}

function liveText(agent: ReturnTypeOfAgent | undefined, identity: Parameters<ReturnTypeOfAgent["store"]["delta"]>[0]) {
  if (!agent) return
  return {
    subscribe: (listener: () => void) => agent.store.subscribeDelta(identity, listener),
    snapshot: () => agent.store.delta(identity)?.text ?? "",
    incomplete: () => agent.store.delta(identity)?.incomplete ?? false,
  }
}

function isVisibleDelta(identity: DeltaIdentity): identity is VisibleDelta {
  return identity.partKind === "text" || identity.partKind === "reasoning"
}

function deltaPartView(agent: ReturnTypeOfAgent, identity: VisibleDelta): AssistantPart {
  return { id: identity.partId, kind: identity.partKind, text: "", live: liveText(agent, identity) }
}

function contentReference(agent: ReturnTypeOfAgent | undefined, sessionId: string, value: unknown) {
  const content = record(value)
  if (!agent || typeof content.id !== "string" || typeof content.revision !== "string" || typeof content.bytes !== "number") return
  return {
    id: content.id,
    revision: content.revision,
    bytes: content.bytes,
    queryKey: [agent.url, "content", content.id, content.revision],
    loadPage: async (offset: number, signal: AbortSignal) => {
      const response = await agent.client.api.content[":contentId"].$get({
        param: { contentId: content.id as string },
        query: { sessionID: sessionId, revision: content.revision as string, offset: String(offset), limit: String(256 * 1024) },
      }, { init: { signal } })
      if (!response.ok) throw new Error("Could not load full output")
      return response.json()
    },
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function string(value: unknown) {
  return typeof value === "string" ? value : ""
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function number(value: unknown) {
  return typeof value === "number" ? value : 0
}

function avatarColor(value: unknown): Project["color"] {
  return ["pink", "mint", "orange", "purple", "cyan", "lime"].includes(String(value)) ? value as Project["color"] : undefined
}

function toolStatus(value: unknown): "pending" | "running" | "completed" | "error" {
  return value === "pending" || value === "running" || value === "error" ? value : "completed"
}

function emptySubscribe() {
  return () => {}
}
