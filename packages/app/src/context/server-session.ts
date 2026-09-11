import { Binary } from "@hena/core/util/binary"
import { retry } from "@hena/core/util/retry"
import type {
  Message,
  HenaClient,
  Part,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionMessage,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
  SessionStatus,
  SnapshotFileDiff,
  Todo,
} from "@hena/sdk/v2/client"
import { batch } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { diffs as cleanDiffs, message as cleanMessage } from "@/utils/diffs"
import { sessionNotFoundError } from "@/utils/server-errors"
import { rootSession } from "@/utils/session-route"
import { preserveSessionRuntime } from "./session-runtime"
import { dropSessionCaches, pickSessionCacheEvictions, SESSION_CACHE_LIMIT } from "./global-sync/session-cache"

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const cmpMessage = (a: Message, b: Message) => a.time.created - b.time.created || cmp(a.id, b.id)
const SKIP_PARTS = new Set(["patch", "step-start", "step-finish"])
const initialMessagePageSize = 20
const historyMessagePageSize = 200
const sessionInfoLimit = 2_048
const emptyIDs: ReadonlySet<string> = new Set()

type OptimisticItem = {
  message: Message
  parts: Part[]
  confirmedParts?: Part[]
  confirmedMessage?: boolean
}

type ExecutionStatus = { type: "running" } | { type: "idle" } | { type: "failed"; error: { message: string } }

type MessagePage = {
  session: Message[]
  part: { id: string; part: Part[] }[]
  order?: string[]
  cursor?: string
  complete: boolean
  managed?: boolean
}

type ServerEvent = { type: string; properties?: unknown; data?: unknown }

const V2_STREAM_EVENTS = new Set([
  "session.next.step.started",
  "session.next.step.ended",
  "session.next.step.failed",
  "session.next.text.started",
  "session.next.text.delta",
  "session.next.text.ended",
  "session.next.reasoning.started",
  "session.next.reasoning.delta",
  "session.next.reasoning.ended",
  "session.next.tool.input.started",
  "session.next.tool.input.delta",
  "session.next.tool.input.ended",
  "session.next.tool.called",
  "session.next.tool.progress",
  "session.next.tool.success",
  "session.next.tool.failed",
])
const V2_CONTENT_EVENTS = new Set([
  ...V2_STREAM_EVENTS,
  "session.next.revert.staged",
  "session.next.revert.cleared",
  "session.next.revert.committed",
])

// Most markers describe the current HTTP attempt; deltaParts persists non-durable stream state across retries.
type MessageLoadState = {
  touchedMessages: Set<string>
  removedMessages: Set<string>
  retainedMessages: Set<string>
  touchedParts: Map<string, Set<string>>
  deltaParts: Map<string, Set<string>>
  carriedDeltaParts: Map<string, Set<string>>
  removedParts: Map<string, Set<string>>
  optimisticParts: Map<string, Set<string>>
  orphanParents: Set<string>
  clearedMessageParts: Set<string>
}

type MessageLoadBaseline = Pick<
  MessageLoadState,
  "touchedMessages" | "retainedMessages" | "touchedParts" | "clearedMessageParts"
>

function mergeOptimisticPage(page: MessagePage, items: OptimisticItem[]) {
  if (items.length === 0) return { ...page, observed: [] as { messageID: string; parts: Part[] }[] }
  const session = [...page.session]
  const part = new Map(page.part.map((item) => [item.id, item.part]))
  const observed: { messageID: string; parts: Part[] }[] = []
  for (const item of items) {
    const result = Binary.search(session, item.message.id, (message) => message.id)
    if (!result.found) session.splice(result.index, 0, item.message)
    const current = part.get(item.message.id)
    const available = [...(current ?? [])]
    const textParts =
      page.managed && item.message.role === "user"
        ? item.parts.filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
        : []
    const joinedText = available.findIndex(
      (part) => part.type === "text" && part.text === textParts.map((part) => part.text).join("\n"),
    )
    const confirmedText = joinedText >= 0 && textParts.length > 0 ? new Set<Part>(textParts) : undefined
    if (confirmedText) available.splice(joinedText, 1)
    const confirmed = result.found
      ? item.parts.filter((part) => {
          if (confirmedText?.has(part)) return true
          const exact = available.findIndex((value) => value.id === part.id)
          const index =
            exact >= 0
              ? exact
              : page.managed && item.message.role === "user"
                ? available.findIndex((value) => sameV2UserPart(value, part))
                : -1
          if (index < 0) return false
          available.splice(index, 1)
          return true
        })
      : []
    if (result.found) observed.push({ messageID: item.message.id, parts: confirmed })
    part.set(
      item.message.id,
      merge(
        result.found ? (current ?? []) : merge(item.confirmedParts ?? [], current ?? []),
        item.parts.filter((part) => !confirmed.includes(part)),
      ),
    )
  }
  return {
    ...page,
    session,
    part: [...part.entries()].sort((a, b) => cmp(a[0], b[0])).map(([id, parts]) => ({ id, part: parts })),
    observed,
  }
}

function sameV2UserPart(a: Part, b: Part) {
  if (a.type !== b.type) return false
  if (a.type === "file" && b.type === "file")
    return (
      a.url === b.url &&
      a.mime === b.mime &&
      a.filename === b.filename &&
      a.source?.text?.value === b.source?.text?.value &&
      a.source?.text?.start === b.source?.text?.start &&
      a.source?.text?.end === b.source?.text?.end
    )
  if (a.type === "agent" && b.type === "agent")
    return (
      a.name === b.name &&
      a.source?.value === b.source?.value &&
      a.source?.start === b.source?.start &&
      a.source?.end === b.source?.end
    )
  return false
}

function runInflight(map: Map<string, Promise<void>>, key: string, task: () => Promise<void>) {
  const pending = map.get(key)
  if (pending) return pending
  const promise = task().finally(() => {
    if (map.get(key) === promise) map.delete(key)
  })
  map.set(key, promise)
  return promise
}

function merge<T extends { id: string }>(a: readonly T[], b: readonly T[]) {
  const items = new Map(a.map((item) => [item.id, item] as const))
  for (const item of b) items.set(item.id, item)
  return [...items.values()].sort((x, y) => cmp(x.id, y.id))
}

function parseToolInput(value: string) {
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // Keep malformed provider input visible as raw text until the authoritative refresh.
  }
  return {}
}

function reconcileFetched<T extends { id: string }>(
  fetched: T[],
  current: readonly T[],
  options: {
    touched?: ReadonlySet<string>
    retained?: ReadonlySet<string>
    removed?: ReadonlySet<string>
    preserveUnfetched?: boolean | ((item: T) => boolean)
  } = {},
) {
  const result = new Map(fetched.map((item) => [item.id, item]))
  const live = new Map(current.map((item) => [item.id, item]))
  if (options.preserveUnfetched) {
    for (const item of current) {
      if (!result.has(item.id) && (options.preserveUnfetched === true || options.preserveUnfetched(item)))
        result.set(item.id, item)
    }
  }
  for (const id of options.retained ?? emptyIDs) {
    if (result.has(id)) continue
    const item = live.get(id)
    if (item) result.set(id, item)
  }
  // Events observed while the request is pending are the freshest client state for those identities.
  for (const id of options.touched ?? emptyIDs) {
    const item = live.get(id)
    if (item) result.set(id, item)
    if (!item) result.delete(id)
  }
  for (const id of options.removed ?? emptyIDs) result.delete(id)
  return [...result.values()].sort((a, b) => cmp(a.id, b.id))
}

function mapV2Messages(values: SessionMessage[], sessionID: string, session?: Session) {
  let parentID = ""
  let agent = session?.agent ?? ""
  let model = session?.model
  const sessionMessages: Message[] = []
  const parts: { id: string; part: Part[] }[] = []
  for (const value of values) {
    // These records change execution context; they are not conversation bubbles.
    if (value.type === "agent-switched") {
      agent = value.agent
      continue
    }
    if (value.type === "model-switched") {
      model = value.model
      continue
    }
    if (value.type === "system" || value.type === "synthetic") continue
    if (value.type === "user" || value.type === "shell" || value.type === "compaction") {
      const message: Message = {
        id: value.id,
        sessionID,
        role: "user",
        time: { created: value.time.created },
        agent,
        model: {
          providerID: model?.providerID ?? "",
          modelID: model?.id ?? "",
          variant: model?.variant,
        },
      }
      sessionMessages.push(message)
      if (value.type === "user") parentID = value.id
      const content: Part[] = []
      if (value.type === "compaction") {
        content.push({
          id: `${value.id}:compaction`,
          sessionID,
          messageID: value.id,
          type: "compaction",
          auto: value.reason === "auto",
        })
      }
      content.push({
        id: `${value.id}:text`,
        sessionID,
        messageID: value.id,
        type: "text",
        text:
          value.type === "user"
            ? value.text
            : value.type === "shell"
              ? `${value.command}\n${value.output}`
              : value.summary,
        synthetic: value.type === "compaction" ? true : undefined,
      })
      if (value.type === "user") {
        content.push(
          ...(value.files ?? []).map(
            (file, index): Part => ({
              id: `${value.id}:file:${index}`,
              sessionID,
              messageID: value.id,
              type: "file",
              url: file.uri,
              mime: file.mime,
              filename: file.name,
              source: file.source
                ? {
                    type: "file",
                    path: file.uri,
                    text: { value: file.source.text, start: file.source.start, end: file.source.end },
                  }
                : undefined,
            }),
          ),
        )
        content.push(
          ...(value.agents ?? []).map(
            (attachment, index): Part => ({
              id: `${value.id}:agent:${index}`,
              sessionID,
              messageID: value.id,
              type: "agent",
              name: attachment.name,
              source: attachment.source
                ? { value: attachment.source.text, start: attachment.source.start, end: attachment.source.end }
                : undefined,
            }),
          ),
        )
      }
      parts.push({ id: value.id, part: content })
      continue
    }
    value.type satisfies "assistant"
    const message: Message = {
      id: value.id,
      sessionID,
      role: "assistant",
      time: { created: value.time.created, completed: value.time.completed },
      parentID,
      modelID: value.model.id,
      providerID: value.model.providerID,
      mode: value.agent,
      agent: value.agent,
      path: { cwd: session?.directory ?? "", root: session?.directory ?? "" },
      cost: value.cost ?? 0,
      tokens: value.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      finish: value.finish,
      error: value.error ? { name: "UnknownError", data: { message: value.error.message } } : undefined,
      variant: value.model.variant,
    }
    sessionMessages.push(message)
    const mappedParts = value.content.flatMap((item) => mapV2Part(item, sessionID, value.id, value.time.created))
    parts.push({ id: value.id, part: mappedParts })
  }
  return { session: sessionMessages, part: parts }
}

function mapV2Part(
  value: SessionMessageAssistantText | SessionMessageAssistantReasoning | SessionMessageAssistantTool,
  sessionID: string,
  messageID: string,
  created: number,
): Part[] {
  if (value.type === "text") {
    return [{ id: value.id, sessionID, messageID, type: value.type, text: value.text }]
  }
  if (value.type === "reasoning") {
    return [
      {
        id: value.id,
        sessionID,
        messageID,
        type: value.type,
        text: value.text,
        time: { start: value.time?.created ?? created, end: value.time?.completed },
        metadata: value.providerMetadata,
      },
    ]
  }
  const state = value.state
  const tool: Part = {
    id: value.id,
    sessionID,
    messageID,
    type: "tool",
    callID: value.id,
    tool: value.name,
    state:
      state.status === "completed"
        ? {
            status: "completed",
            input: state.input,
            output: JSON.stringify(state.result ?? state.content) ?? "",
            title: value.name,
            metadata: { structured: state.structured },
            time: {
              start: value.time.ran ?? value.time.created,
              end: value.time.completed ?? value.time.created,
              compacted: value.time.pruned,
            },
          }
        : state.status === "error"
          ? {
              status: "error",
              input: state.input,
              error: state.error.message,
              time: { start: value.time.ran ?? value.time.created, end: value.time.completed ?? value.time.created },
            }
          : state.status === "running"
            ? {
                status: "running",
                input: state.input,
                time: { start: value.time.ran ?? value.time.created },
                metadata: { structured: state.structured },
              }
            : { status: "pending", input: {}, raw: state.input },
  }
  return [tool]
}

export function createServerSession(
  client: HenaClient,
  options?: { retry?: typeof retry; managedSession?: (session: Session) => boolean | Promise<boolean> },
) {
  const [data, setData] = createStore({
    info: {} as Record<string, Session | undefined>,
    session_status: {} as Record<string, SessionStatus>,
    execution_error: {} as Record<string, string | undefined>,
    session_diff: {} as Record<string, SnapshotFileDiff[]>,
    todo: {} as Record<string, Todo[]>,
    permission: {} as Record<string, PermissionRequest[]>,
    question: {} as Record<string, QuestionRequest[]>,
    message: {} as Record<string, Message[]>,
    part: {} as Record<string, Part[]>,
    part_order: {} as Record<string, string[]>,
    part_text_accum_delta: {} as Record<string, string>,
    session_working(id: string) {
      return (this.session_status[id]?.type ?? "idle") !== "idle"
    },
  })
  const requests = new Map<string, Promise<Session>>()
  const inflight = new Map<string, Promise<void>>()
  const inflightDiff = new Map<string, Promise<void>>()
  const inflightTodo = new Map<string, Promise<void>>()
  const optimistic = new Map<string, Map<string, OptimisticItem>>()
  const executionRevisions = new Map<string, number>()
  const v2Sessions = new Set<string>()
  const managedSessions = new Map<string, boolean>()
  const v2Assistants = new Map<string, Extract<Message, { role: "assistant" }>>()
  const pendingV2Events = new Map<string, ServerEvent[]>()
  const messageLoads = new Map<string, MessageLoadState>()
  const pendingParts = new Map<string, Map<string, Set<string>>>()
  const orphanParts = new Map<string, Set<string>>()
  const removedMessages = new Map<string, Set<string>>()
  const messageOrder = new Map<string, string[]>()
  const deltaBases = new Map<string, { base: string; sessionID: string }>()
  const deleteMessageParts = (
    cache: {
      part: Record<string, Part[] | undefined>
      part_order: Record<string, string[] | undefined>
      part_text_accum_delta: Record<string, string | undefined>
    },
    messageID: string,
  ) => {
    for (const part of cache.part[messageID] ?? []) {
      delete cache.part_text_accum_delta[part.id]
      deltaBases.delete(part.id)
    }
    delete cache.part[messageID]
    delete cache.part_order[messageID]
  }
  const seen = new Set<string>()
  const infoSeen = new Set<string>()
  const resolvedInfo = new Set<string>()
  const pinned = new Map<string, number>()
  const generations = new Map<string, object>()
  const generation = (sessionID: string) => {
    const current = generations.get(sessionID)
    if (current) return current
    const created = {}
    generations.set(sessionID, created)
    return created
  }
  const [meta, setMeta] = createStore({
    limit: {} as Record<string, number | undefined>,
    cursor: {} as Record<string, string | undefined>,
    complete: {} as Record<string, boolean | undefined>,
    loading: {} as Record<string, boolean | undefined>,
    at: {} as Record<string, number | undefined>,
  })

  const remember = (session: Session) => {
    const next = preserveSessionRuntime(data.info[session.id], session)
    setData("info", session.id, reconcile(next))
    if (next.metadata?.appRuntime) managedSessions.set(session.id, next.metadata.appRuntime === "canonical")
    infoSeen.delete(session.id)
    infoSeen.add(session.id)
    if (infoSeen.size > sessionInfoLimit) {
      const preserve = new Set([
        ...pinned.keys(),
        ...requests.keys(),
        ...inflight.keys(),
        ...inflightDiff.keys(),
        ...inflightTodo.keys(),
        ...messageLoads.keys(),
        ...optimistic.keys(),
        ...Object.entries(data.permission)
          .filter(([, items]) => items.length > 0)
          .map(([sessionID]) => sessionID),
        ...Object.entries(data.question)
          .filter(([, items]) => items.length > 0)
          .map(([sessionID]) => sessionID),
        ...Object.entries(data.session_status)
          .filter(([, status]) => status.type !== "idle")
          .map(([sessionID]) => sessionID),
      ])
      for (const sessionID of preserve) {
        let current = data.info[sessionID]
        while (current) {
          preserve.add(current.id)
          current = current.parentID ? data.info[current.parentID] : undefined
        }
      }
      const stale: string[] = []
      for (const sessionID of infoSeen) {
        if (infoSeen.size - stale.length <= sessionInfoLimit) break
        if (!preserve.has(sessionID)) stale.push(sessionID)
      }
      stale.forEach((sessionID) => infoSeen.delete(sessionID))
      stale.forEach((sessionID) => resolvedInfo.delete(sessionID))
      stale.forEach((sessionID) => generations.delete(sessionID))
      setData(
        "info",
        produce((draft) => stale.forEach((sessionID) => delete draft[sessionID])),
      )
    }
    return next
  }

  const resolve = (sessionID: string, settings?: { force?: boolean }) => {
    const cached = data.info[sessionID]
    if (cached && !settings?.force && (!options?.managedSession || resolvedInfo.has(sessionID) || cached.metadata?.appRuntime))
      return Promise.resolve(cached)
    const pending = requests.get(sessionID)
    if (pending) return pending
    const active = generation(sessionID)
    const request = client.session.get({ sessionID }).then((result) => {
      if (!result.data) throw sessionNotFoundError(sessionID)
      if (generations.get(sessionID) !== active) return result.data
      resolvedInfo.add(sessionID)
      return remember(result.data)
    })
    requests.set(sessionID, request)
    const cleanup = () => {
      if (requests.get(sessionID) === request) requests.delete(sessionID)
      if (
        generations.get(sessionID) === active &&
        !data.info[sessionID] &&
        !requests.has(sessionID) &&
        !messageLoads.has(sessionID) &&
        !inflight.has(sessionID) &&
        !inflightDiff.has(sessionID) &&
        !inflightTodo.has(sessionID)
      )
        generations.delete(sessionID)
    }
    void request.then(cleanup, cleanup)
    return request
  }

  const peekLineage = (sessionID: string) => {
    const session = data.info[sessionID]
    if (!session) return
    const seen = new Set([session.id])
    let root = session
    while (root.parentID) {
      if (seen.has(root.parentID)) throw new Error(`Session parent cycle: ${root.parentID}`)
      seen.add(root.parentID)
      const parent = data.info[root.parentID]
      if (!parent) return
      root = parent
    }
    return { session, root }
  }

  const clearOptimistic = (sessionID: string, messageID?: string) => {
    if (!messageID) {
      optimistic.delete(sessionID)
      return
    }
    const items = optimistic.get(sessionID)
    if (!items) return
    items.delete(messageID)
    if (items.size === 0) optimistic.delete(sessionID)
  }

  const clearOptimisticPart = (sessionID: string, messageID: string, partID: string) => {
    const items = optimistic.get(sessionID)
    const item = items?.get(messageID)
    if (!items || !item) return
    const parts = item.parts.filter((part) => part.id !== partID)
    const confirmedParts = item.confirmedParts?.filter((part) => part.id !== partID)
    if (parts.length === 0) {
      clearOptimistic(sessionID, messageID)
      return
    }
    items.set(messageID, { ...item, parts, confirmedParts, confirmedMessage: true })
  }

  const confirmOptimisticPart = (sessionID: string, messageID: string, part: Part) => {
    const items = optimistic.get(sessionID)
    const item = items?.get(messageID)
    if (!items || !item) return
    const parts = item.parts.filter((value) => value.id !== part.id)
    if (parts.length === 0) {
      clearOptimistic(sessionID, messageID)
      return
    }
    items.set(messageID, {
      ...item,
      parts,
      confirmedParts: merge(item.confirmedParts ?? [], [part]),
      confirmedMessage: true,
    })
  }

  const confirmOptimistic = (sessionID: string, messageID: string, confirmedParts: Part[]) => {
    const items = optimistic.get(sessionID)
    const item = items?.get(messageID)
    if (!items || !item) return
    const confirmed = new Set(confirmedParts.map((part) => part.id))
    const parts = item.parts.filter((part) => !confirmed.has(part.id))
    if (parts.length === 0) {
      clearOptimistic(sessionID, messageID)
      return
    }
    items.set(messageID, {
      ...item,
      parts,
      confirmedParts: merge(item.confirmedParts ?? [], confirmedParts),
      confirmedMessage: true,
    })
  }

  const trackPartChange = (sessionID: string, messageID: string, partID: string) => {
    const load = messageLoads.get(sessionID)
    if (!load) return
    // A part event keeps an existing parent when the fetched page omits it without overriding fetched metadata.
    const messages = data.message[sessionID]
    if (messages && Binary.search(messages, messageID, (message) => message.id).found)
      load.retainedMessages.add(messageID)
    const parts = load.touchedParts.get(messageID)
    if (parts) {
      parts.add(partID)
      return
    }
    load.touchedParts.set(messageID, new Set([partID]))
  }

  const resetMessageLoad = (sessionID: string, load: MessageLoadState, baseline?: MessageLoadBaseline) => {
    load.touchedMessages.clear()
    load.retainedMessages.clear()
    load.touchedParts.clear()
    load.carriedDeltaParts.clear()
    load.clearedMessageParts.clear()
    for (const messageID of load.removedMessages) {
      load.touchedMessages.add(messageID)
      load.clearedMessageParts.add(messageID)
    }
    for (const [messageID, parts] of load.deltaParts) {
      load.touchedParts.set(messageID, new Set(parts))
      load.carriedDeltaParts.set(messageID, new Set(parts))
      const messages = data.message[sessionID]
      if (messages && Binary.search(messages, messageID, (message) => message.id).found)
        load.retainedMessages.add(messageID)
    }
    for (const [messageID, parts] of load.removedParts) {
      const touched = load.touchedParts.get(messageID) ?? new Set<string>()
      parts.forEach((partID) => touched.add(partID))
      load.touchedParts.set(messageID, touched)
      const messages = data.message[sessionID]
      if (messages && Binary.search(messages, messageID, (message) => message.id).found)
        load.retainedMessages.add(messageID)
    }
    for (const [messageID, parts] of load.optimisticParts) {
      load.removedMessages.delete(messageID)
      load.clearedMessageParts.add(messageID)
      load.touchedMessages.add(messageID)
      const touched = load.touchedParts.get(messageID) ?? new Set<string>()
      parts.forEach((partID) => touched.add(partID))
      load.touchedParts.set(messageID, touched)
    }
    baseline?.touchedMessages.forEach((messageID) => load.touchedMessages.add(messageID))
    baseline?.retainedMessages.forEach((messageID) => load.retainedMessages.add(messageID))
    baseline?.clearedMessageParts.forEach((messageID) => load.clearedMessageParts.add(messageID))
    baseline?.touchedParts.forEach((parts, messageID) => {
      const touched = load.touchedParts.get(messageID) ?? new Set<string>()
      parts.forEach((partID) => touched.add(partID))
      load.touchedParts.set(messageID, touched)
    })
  }

  const messageLoadBaseline = (load: MessageLoadState, exclude: string): MessageLoadBaseline => ({
    touchedMessages: new Set([...load.touchedMessages].filter((messageID) => messageID !== exclude)),
    retainedMessages: new Set([...load.retainedMessages].filter((messageID) => messageID !== exclude)),
    touchedParts: new Map(
      [...load.touchedParts]
        .filter(([messageID]) => messageID !== exclude)
        .map(([messageID, parts]) => [messageID, new Set(parts)]),
    ),
    clearedMessageParts: new Set([...load.clearedMessageParts].filter((messageID) => messageID !== exclude)),
  })

  const evict = (sessionIDs: string[]) => {
    if (sessionIDs.length === 0) return
    const evicted = new Set(sessionIDs)
    for (const [partID, item] of deltaBases) {
      if (evicted.has(item.sessionID)) deltaBases.delete(partID)
    }
    for (const [messageID, assistant] of v2Assistants) {
      if (evicted.has(assistant.sessionID)) v2Assistants.delete(messageID)
    }
    sessionIDs.forEach((sessionID) => {
      generations.delete(sessionID)
      clearOptimistic(sessionID)
      requests.delete(sessionID)
      inflight.delete(sessionID)
      inflightDiff.delete(sessionID)
      inflightTodo.delete(sessionID)
      messageLoads.delete(sessionID)
      pendingParts.delete(sessionID)
      orphanParts.delete(sessionID)
      removedMessages.delete(sessionID)
      messageOrder.delete(sessionID)
      managedSessions.delete(sessionID)
      pendingV2Events.delete(sessionID)
      v2Sessions.delete(sessionID)
      executionRevisions.delete(sessionID)
    })
    setData(
      produce((draft) => {
        dropSessionCaches(draft, sessionIDs)
      }),
    )
    setMeta(
      produce((draft) => {
        for (const sessionID of sessionIDs) {
          delete draft.limit[sessionID]
          delete draft.cursor[sessionID]
          delete draft.complete[sessionID]
          delete draft.loading[sessionID]
          delete draft.at[sessionID]
        }
      }),
    )
  }

  const protectedSessions = () =>
    new Set([
      ...pinned.keys(),
      ...requests.keys(),
      ...inflight.keys(),
      ...inflightDiff.keys(),
      ...inflightTodo.keys(),
      ...messageLoads.keys(),
      ...optimistic.keys(),
      ...Object.entries(data.permission)
        .filter(([, items]) => items.length > 0)
        .map(([sessionID]) => sessionID),
      ...Object.entries(data.question)
        .filter(([, items]) => items.length > 0)
        .map(([sessionID]) => sessionID),
      ...Object.entries(data.session_status)
        .filter(([, status]) => status.type !== "idle")
        .map(([sessionID]) => sessionID),
    ])

  const touch = (sessionID: string) =>
    evict(
      pickSessionCacheEvictions({ seen, keep: sessionID, limit: SESSION_CACHE_LIMIT, preserve: protectedSessions() }),
    )

  const fetchMessages = async (sessionID: string, limit: number, before?: string, onAttempt?: () => void): Promise<MessagePage> => {
    const managed = options?.managedSession?.(data.info[sessionID]!)
    const useManagedHistory = managed === true || (managed !== undefined && managed !== false && (await managed))
    if (options?.managedSession) managedSessions.set(sessionID, useManagedHistory)
    if (useManagedHistory) {
      // A whole turn can exceed the transport's 200-record page limit.
      const pageLimit = Math.max(1, Math.min(limit, 200))
      return (options?.retry ?? retry)(async () => {
        // One attempt covers the whole window; fetching its ancestors must not reset live-update tracking.
        onAttempt?.()
        let cursor = before
        let values: SessionMessage[] = []
        let lastPageSize = 0
        while (true) {
          const response = await client.v2.session.messages({ sessionID, limit: pageLimit, order: cursor ? undefined : "desc", cursor })
          const page = response.data?.data ?? []
          values = values.concat(page)
          lastPageSize = page.length
          cursor = response.data?.cursor.next
          // The oldest assistant in the window needs its real preceding user, not a cached timestamp guess.
          const oldest = values.findLast((value) => value.type === "user" || value.type === "assistant")
          if (oldest?.type === "user" || !lastPageSize || lastPageSize < pageLimit || !cursor) break
        }
        const mapped = mapV2Messages(values.toReversed(), sessionID, data.info[sessionID])
        return {
          order: mapped.session.map((message) => message.id),
          session: mapped.session.sort((a, b) => cmp(a.id, b.id)),
          part: mapped.part,
          cursor,
          complete: !lastPageSize || lastPageSize < pageLimit || !cursor,
          managed: true,
        }
      })
    }
    const response = await (options?.retry ?? retry)(() => {
      onAttempt?.()
      return client.session.messages({ sessionID, limit, before })
    })
    const items = (response.data ?? []).filter((item) => !!item?.info?.id)
    const session = items.map((item) => cleanMessage(item.info))
    return {
      order: session.map((message) => message.id),
      session: session.sort((a, b) => cmp(a.id, b.id)),
      part: items.map((item) => ({
        id: item.info.id,
        part: item.parts.filter((part) => !!part?.id).sort((a, b) => cmp(a.id, b.id)),
      })),
      cursor: response.response.headers.get("x-next-cursor") ?? undefined,
      complete: !response.response.headers.get("x-next-cursor"),
    }
  }

  const fetchMessage = async (sessionID: string, messageID: string, onAttempt?: () => void) => {
    const managed = options?.managedSession?.(data.info[sessionID]!)
    if (managed === true || (managed !== undefined && managed !== false && (await managed))) {
      const response = await (options?.retry ?? retry)(() => {
        onAttempt?.()
        return client.v2.session.message({ sessionID, messageID })
      })
      if (!response.data?.data) throw new Error(`Message not found: ${messageID}`)
      const mapped = mapV2Messages([response.data.data], sessionID, data.info[sessionID])
      const message = mapped.session[0]
      if (!message) throw new Error(`Message not found: ${messageID}`)
      return { message, parts: mapped.part.find((item) => item.id === messageID)?.part ?? [] }
    }
    const response = await (options?.retry ?? retry)(() => {
      onAttempt?.()
      return client.session.message({ sessionID, messageID })
    })
    if (!response.data?.info?.id) throw new Error(`Message not found: ${messageID}`)
    return {
      message: cleanMessage(response.data.info),
      parts: response.data.parts.filter((part) => !!part?.id).sort((a, b) => cmp(a.id, b.id)),
    }
  }

  const replaceMessages = (sessionID: string, messages: Message[]) => {
    const messageIDs = new Set(messages.map((message) => message.id))
    const dropped = (data.message[sessionID] ?? []).filter((message) => !messageIDs.has(message.id))
    setData("message", sessionID, reconcile(messages, { key: "id" }))
    setData(
      produce((draft) => {
        for (const message of dropped) deleteMessageParts(draft, message.id)
      }),
    )
    return messageIDs
  }

  const applyMessageOrder = (sessionID: string, page: MessagePage, messages: Message[], prepend: boolean) => {
    if (!page.order) return
    const current = messageOrder.get(sessionID) ?? []
    const fetched = new Set(page.order)
    const first = prepend
      ? 0
      : current.reduce((index, id, position) => (fetched.has(id) ? Math.min(index, position) : index), current.length)
    const remaining = current.filter((id) => !fetched.has(id))
    const index = first - current.slice(0, first).filter((id) => fetched.has(id)).length
    const order = [...remaining.slice(0, index), ...page.order, ...remaining.slice(index)]
    const ordered = new Set(order)
    messages.forEach((message) => {
      if (!ordered.has(message.id)) order.push(message.id)
    })
    const live = new Set(messages.map((message) => message.id))
    messageOrder.set(sessionID, order.filter((id) => live.has(id)))
  }

  const timeline = (sessionID: string) => {
    const messages = data.message[sessionID] ?? []
    const order = messageOrder.get(sessionID)
    if (!order) return messages
    const byID = new Map(messages.map((message) => [message.id, message]))
    const known = new Set(order)
    return [...order.flatMap((id) => byID.get(id) ?? []), ...messages.filter((message) => !known.has(message.id))]
  }

  const orderedParts = (messageID: string) => {
    const parts = data.part[messageID]
    const order = data.part_order[messageID]
    if (!parts || !order) return parts
    const byID = new Map(parts.map((part) => [part.id, part]))
    const known = new Set(order)
    return [...order.flatMap((id) => byID.get(id) ?? []), ...parts.filter((part) => !known.has(part.id))]
  }

  const replaceParts = (
    sessionID: string,
    items: MessagePage["part"],
    messageIDs: Set<string>,
    load?: MessageLoadState,
  ) => {
    for (const item of items) {
      if (!messageIDs.has(item.id)) continue
      const fetched = load?.clearedMessageParts.has(item.id)
        ? []
        : item.part.filter((part) => !SKIP_PARTS.has(part.type))
      const fetchedIDs = new Set(fetched.map((part) => part.id))
      const pending = pendingParts.get(sessionID)?.get(item.id)
      const touched = new Set([...(load?.touchedParts.get(item.id) ?? []), ...(pending ?? [])])
      for (const part of fetched) {
        const accumulated = data.part_text_accum_delta[part.id]
        const base = deltaBases.get(part.id)?.base
        const preserveDelta =
          base !== undefined &&
          accumulated !== undefined &&
          "text" in part &&
          typeof part.text === "string" &&
          part.text.startsWith(base) &&
          accumulated.startsWith(part.text) &&
          accumulated !== part.text
        if (preserveDelta) touched.add(part.id)
        if (load?.carriedDeltaParts.get(item.id)?.has(part.id) && !preserveDelta) touched.delete(part.id)
      }
      for (const partID of load?.carriedDeltaParts.get(item.id) ?? []) {
        if (!fetchedIDs.has(partID)) touched.delete(partID)
      }
      const current = data.part[item.id] ?? []
      const parts = reconcileFetched(fetched, current, { touched })
      if (!parts.length) {
        orphanParts.get(sessionID)?.delete(item.id)
        setData(produce((draft) => deleteMessageParts(draft, item.id)))
        continue
      }
      const partIDs = new Set(parts.map((part) => part.id))
      setData(
        "part_text_accum_delta",
        produce((draft) => {
          for (const part of current) {
            if (!partIDs.has(part.id) || !touched.has(part.id)) {
              delete draft[part.id]
              deltaBases.delete(part.id)
            }
          }
        }),
      )
      setData("part", item.id, current.some((part) => partIDs.has(part.id)) ? reconcile(parts, { key: "id" }) : parts)
      orphanParts.get(sessionID)?.delete(item.id)
    }
  }

  const applyMessagePage = (
    sessionID: string,
    page: MessagePage,
    load: MessageLoadState | undefined,
    preserveUnfetched: boolean | ((message: Message) => boolean),
    cleanupOrphans: boolean,
    prepend: boolean,
  ) => {
    const merged = mergeOptimisticPage(page, [...(optimistic.get(sessionID)?.values() ?? [])])
    merged.observed.forEach((item) => {
      if (!load?.clearedMessageParts.has(item.messageID)) confirmOptimistic(sessionID, item.messageID, item.parts)
    })
    const touchedMessages = new Set([...(load?.touchedMessages ?? []), ...(removedMessages.get(sessionID) ?? [])])
    const messages = reconcileFetched(merged.session, data.message[sessionID] ?? [], {
      touched: touchedMessages,
      retained: load?.retainedMessages,
      removed: load?.removedMessages,
      preserveUnfetched,
    })
    batch(() => {
      applyMessageOrder(sessionID, merged, messages, prepend)
      const messageIDs = replaceMessages(sessionID, messages)
      replaceParts(sessionID, merged.part, messageIDs, load)
      if (page.managed) {
        for (const item of page.part) {
          const present = new Set(data.part[item.id]?.map((part) => part.id))
          if (!present.size) continue
          const fetched = item.part.map((part) => part.id)
          const known = new Set(fetched)
          setData("part_order", item.id, reconcile([
            ...fetched,
            ...(data.part_order[item.id] ?? []).filter((id) => !known.has(id)),
          ].filter((id) => present.has(id))))
        }
      }
      const orphans = orphanParts.get(sessionID)
      if (cleanupOrphans && page.complete && orphans) {
        for (const messageID of orphans) {
          if (!messageIDs.has(messageID)) setData(produce((draft) => deleteMessageParts(draft, messageID)))
        }
        orphanParts.delete(sessionID)
      }
      setMeta("limit", sessionID, messages.length)
      setMeta("cursor", sessionID, merged.cursor)
      setMeta("complete", sessionID, merged.complete)
      setMeta("at", sessionID, Date.now())
    })
  }

  const loadMessages = async (sessionID: string, limit: number, before?: string, mode?: "replace" | "prepend") => {
    if (meta.loading[sessionID]) return
    const active = generation(sessionID)
    const load: MessageLoadState = {
      touchedMessages: new Set(),
      removedMessages: new Set(),
      retainedMessages: new Set(),
      touchedParts: new Map(),
      deltaParts: new Map(),
      carriedDeltaParts: new Map(),
      removedParts: new Map(),
      optimisticParts: new Map(),
      orphanParents: new Set(),
      clearedMessageParts: new Set(),
    }
    messageLoads.set(sessionID, load)
    setMeta("loading", sessionID, true)
    let applied = false
    try {
      const fetched = await fetchMessages(sessionID, limit, before, () => resetMessageLoad(sessionID, load))
      const page = {
        ...fetched,
        session: fetched.session.map((message) => {
          if (fetched.managed || message.role !== "assistant" || message.parentID) return message
          const parent = (data.message[sessionID] ?? [])
            .filter((item): item is Extract<Message, { role: "user" }> => item.role === "user")
            .filter((item) => cmpMessage(item, message) < 0)
            .reduce<Message | undefined>(
              (latest, item) => (!latest || cmpMessage(item, latest) > 0 ? item : latest),
              undefined,
            )
          return parent ? { ...message, parentID: parent.id } : message
        }),
      }
      const first = page.session.reduce<Message | undefined>(
        (oldest, message) => (!oldest || cmpMessage(message, oldest) < 0 ? message : oldest),
        undefined,
      )
      if (generations.get(sessionID) !== active) return

      const parents = [] as Awaited<ReturnType<typeof fetchMessage>>[]
      if (mode !== "prepend") {
        const users = new Set([
          ...page.session.filter((message) => message.role === "user").map((message) => message.id),
          ...(data.message[sessionID] ?? [])
            .filter((message) => {
              if (message.role !== "user") return false
              const item = optimistic.get(sessionID)?.get(message.id)
              return load.touchedMessages.has(message.id) && (!item || item.confirmedMessage === true)
            })
            .map((message) => message.id),
        ])
        const parentIDs = [
          ...new Set(
            page.session.flatMap((message) =>
              message.role === "assistant" && message.parentID && !users.has(message.parentID)
                ? [message.parentID]
                : [],
            ),
          ),
        ]
        for (const parentID of parentIDs) {
          if (generations.get(sessionID) !== active) break
          const parent = await fetchMessage(sessionID, parentID, () =>
            resetMessageLoad(sessionID, load, messageLoadBaseline(load, parentID)),
          ).catch((error) => {
            const cause = error instanceof Error && typeof error.cause === "object" ? error.cause : undefined
            if (cause && "status" in cause && cause.status === 404) {
              load.removedMessages.add(parentID)
              return
            }
            throw error
          })
          if (!parent) continue
          if (parent.message.role !== "user") throw new Error(`Assistant parent is not a user message: ${parentID}`)
          parents.push(parent)
        }
      }
      if (generations.get(sessionID) !== active) return
      const result =
        mode === "prepend"
          ? page
          : {
              ...page,
              session: merge(
                page.session,
                parents.map((parent) => parent.message),
              ),
              part: merge(
                page.part,
                parents.map((parent) => ({ id: parent.message.id, part: parent.parts })),
              ),
            }
      // Keep the cached prefix by canonical sequence, not by clock time or ID spelling.
      const currentOrder = result.managed ? messageOrder.get(sessionID) : undefined
      const firstFetched = currentOrder?.findIndex((id) => result.order?.includes(id))
      const olderIDs = currentOrder
        ? new Set(currentOrder.slice(0, firstFetched === -1 ? undefined : firstFetched))
        : emptyIDs
      const preserveUnfetched =
        mode === "prepend" ||
        (!result.complete &&
          (result.managed
            ? (message: Message) => olderIDs.has(message.id)
            : !first || ((message: Message) => cmpMessage(message, first) < 0)))
      applyMessagePage(
        sessionID,
        result,
        messageLoads.get(sessionID) === load ? load : undefined,
        preserveUnfetched,
        mode !== "prepend",
        mode === "prepend",
      )
      applied = true
    } finally {
      if (!applied && generations.get(sessionID) === active && messageLoads.get(sessionID) === load) {
        for (const messageID of load.orphanParents) {
          if (!orphanParts.get(sessionID)?.has(messageID)) continue
          setData(produce((draft) => deleteMessageParts(draft, messageID)))
          orphanParts.get(sessionID)?.delete(messageID)
        }
        if (orphanParts.get(sessionID)?.size === 0) orphanParts.delete(sessionID)
      }
      if (messageLoads.get(sessionID) === load) messageLoads.delete(sessionID)
      if (generations.get(sessionID) === active) setMeta("loading", sessionID, false)
    }
  }

  const sync = (sessionID: string, requestOptions?: { force?: boolean; messageLimit?: number }) => {
    touch(sessionID)
    return runInflight(inflight, sessionID, async () => {
      const cached = data.message[sessionID] !== undefined && meta.limit[sessionID] !== undefined
      if (cached && data.info[sessionID] && !requestOptions?.force) return
      if (!options?.managedSession) {
        await Promise.all([
          resolve(sessionID, requestOptions),
          cached && !requestOptions?.force
            ? Promise.resolve()
            : loadMessages(sessionID, requestOptions?.messageLimit ?? meta.limit[sessionID] ?? initialMessagePageSize),
        ])
        return
      }
      await resolve(sessionID, requestOptions)
      if (cached && !requestOptions?.force) return
      await loadMessages(sessionID, requestOptions?.messageLimit ?? meta.limit[sessionID] ?? initialMessagePageSize)
    }).then(
      () => flushV2Events(sessionID),
      (error) => {
        pendingV2Events.delete(sessionID)
        throw error
      },
    )
  }

  const prefetch = async (sessionID: string, limit: number) => {
    touch(sessionID)
    await inflight.get(sessionID)
    if (
      Date.now() - (meta.at[sessionID] ?? 0) <= 15_000 &&
      (meta.complete[sessionID] || (data.message[sessionID]?.length ?? 0) >= limit)
    )
      return
    await runInflight(inflight, sessionID, () => loadMessages(sessionID, limit))
  }

  function flushV2Events(sessionID: string) {
    if (!data.info[sessionID] || data.message[sessionID] === undefined) return
    const events = pendingV2Events.get(sessionID)
    if (!events) return
    pendingV2Events.delete(sessionID)
    for (const event of events) apply(event)
  }

  const eventProperties = (event: { type: string; properties?: unknown; data?: unknown }) =>
    event.properties ?? event.data

  const setExecutionStatus = (sessionID: string, status: ExecutionStatus) => {
    v2Sessions.add(sessionID)
    executionRevisions.set(sessionID, (executionRevisions.get(sessionID) ?? 0) + 1)
    if (status.type === "failed") setData("execution_error", sessionID, status.error.message)
    else setData("execution_error", sessionID, undefined)
    setData(
      "session_status",
      sessionID,
      status.type === "failed" ? { type: "idle" } : { type: status.type === "running" ? "busy" : "idle" },
    )
  }

  const eventSessionID = (event: { type: string; properties?: unknown; data?: unknown }) => {
    const properties = eventProperties(event)
    if (!properties || typeof properties !== "object") return
    if ("sessionID" in properties && typeof properties.sessionID === "string") return properties.sessionID
    if (
      "info" in properties &&
      properties.info &&
      typeof properties.info === "object" &&
      "sessionID" in properties.info &&
      typeof properties.info.sessionID === "string"
    )
      return properties.info.sessionID
    if (
      "part" in properties &&
      properties.part &&
      typeof properties.part === "object" &&
      "sessionID" in properties.part &&
      typeof properties.part.sessionID === "string"
    )
      return properties.part.sessionID
  }

  const upsertV2Message = (message: Message) => {
    const messages = data.message[message.sessionID] ?? []
    const result = Binary.search(messages, message.id, (item) => item.id)
    if (result.found) setData("message", message.sessionID, result.index, reconcile(message))
    else
      setData("message", message.sessionID, (value = []) => {
        const next = value.slice()
        next.splice(result.index, 0, message)
        return next
      })
    const order = messageOrder.get(message.sessionID)
    if (order && !order.includes(message.id)) messageOrder.set(message.sessionID, [...order, message.id])
  }

  const upsertV2Part = (part: Part) => {
    trackPartChange(part.sessionID, part.messageID, part.id)
    const parts = data.part[part.messageID] ?? []
    const result = Binary.search(parts, part.id, (item) => item.id)
    batch(() => {
      const order = data.part_order[part.messageID] ?? parts.map((part) => part.id)
      if (!data.part_order[part.messageID] || !order.includes(part.id))
        setData("part_order", part.messageID, order.includes(part.id) ? order : [...order, part.id])
      if (result.found) setData("part", part.messageID, result.index, reconcile(part))
      else
        setData("part", part.messageID, (value = []) => {
          const next = value.slice()
          next.splice(result.index, 0, part)
          return next
        })
    })
  }

  const v2Assistant = (messageID: string, sessionID?: string) => {
    const message = sessionID
      ? data.message[sessionID]?.find(
          (item): item is Extract<Message, { role: "assistant" }> => item.id === messageID && item.role === "assistant",
        )
      : undefined
    if (!message) {
      const cached = v2Assistants.get(messageID)
      return !sessionID || cached?.sessionID === sessionID ? cached : undefined
    }
    v2Assistants.set(messageID, message)
    return message
  }

  const ensureV2Assistant = (input: {
    sessionID: string
    assistantMessageID: string
    timestamp: number
    agent: string
    model: { providerID: string; id: string; variant?: string }
  }) => {
    const existing = v2Assistant(input.assistantMessageID, input.sessionID)
    if (existing) return existing
    const session = data.info[input.sessionID]
    const parentID = timeline(input.sessionID).findLast((message) => message.role === "user")?.id
    if (!session || !parentID) return
    const message: Extract<Message, { role: "assistant" }> = {
      id: input.assistantMessageID,
      sessionID: input.sessionID,
      role: "assistant",
      time: { created: input.timestamp },
      parentID,
      modelID: input.model.id,
      providerID: input.model.providerID,
      mode: input.agent,
      agent: input.agent,
      path: { cwd: session.directory, root: session.directory },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      variant: input.model.variant,
    }
    v2Assistants.set(message.id, message)
    upsertV2Message(message)
    return message
  }

  const updateV2Assistant = (
    messageID: string,
    sessionID: string | undefined,
    update: Partial<Extract<Message, { role: "assistant" }>>,
  ) => {
    const current = v2Assistant(messageID, sessionID)
    if (!current) return
    const next = { ...current, ...update }
    v2Assistants.set(messageID, next)
    upsertV2Message(next)
  }

  const apply = (rawEvent: { type: string; properties?: unknown; data?: unknown }) => {
    const event = { ...rawEvent, properties: eventProperties(rawEvent) }
    const eventID = eventSessionID(event)
    if (eventID && (event.type === "session.next.prompt.admitted" || event.type === "question.v2.asked")) {
      const info = data.info[eventID]
      if (info) remember({ ...info, metadata: { ...info.metadata, appRuntime: "canonical" } })
      managedSessions.set(eventID, true)
    }
    if (eventID && options?.managedSession && V2_CONTENT_EVENTS.has(event.type)) {
      const managed = managedSessions.get(eventID)
      if (managed === false) return
      if (managed === undefined) {
        const events = pendingV2Events.get(eventID) ?? []
        events.push(rawEvent)
        pendingV2Events.set(eventID, events)
        void sync(eventID).catch(() => {})
        return
      }
    }
    if (eventID && V2_STREAM_EVENTS.has(event.type) && (!data.info[eventID] || data.message[eventID] === undefined)) {
      const events = pendingV2Events.get(eventID) ?? []
      events.push(rawEvent)
      pendingV2Events.set(eventID, events)
      void sync(eventID).catch(() => {})
      return
    }
    if (eventID && pendingV2Events.has(eventID)) flushV2Events(eventID)
    if (eventID) {
      touch(eventID)
      if (
        !data.info[eventID] &&
        event.type !== "session.created" &&
        event.type !== "session.updated" &&
        event.type !== "session.deleted"
      )
        void resolve(eventID).catch(() => {})
    }
    switch (event.type) {
      case "session.created":
        remember((event.properties as { info: Session }).info)
        return
      case "session.updated": {
        const info = (event.properties as { info: Session }).info
        remember(info)
        if (info.time.archived) evict([info.id])
        return
      }
      case "session.deleted": {
        const sessionID = (event.properties as { info: Session }).info.id
        infoSeen.delete(sessionID)
        resolvedInfo.delete(sessionID)
        setData(
          "info",
          produce((draft) => void delete draft[sessionID]),
        )
        evict([sessionID])
        return
      }
      case "session.diff": {
        const props = event.properties as { sessionID: string; diff: SnapshotFileDiff[] }
        setData("session_diff", props.sessionID, reconcile(cleanDiffs(props.diff), { key: "file" }))
        return
      }
      case "todo.updated": {
        const props = event.properties as { sessionID: string; todos: Todo[] }
        setData("todo", props.sessionID, reconcile(props.todos, { key: "id" }))
        return
      }
      case "session.status": {
        const props = event.properties as { sessionID: string; status: SessionStatus }
        setData("session_status", props.sessionID, reconcile(props.status))
        return
      }
      case "session.next.execution.status": {
        const props = event.properties as {
          sessionID: string
          status: { type: "running" } | { type: "idle" } | { type: "failed"; error: { message: string } }
        }
        if (props.status.type === "failed") {
          setExecutionStatus(props.sessionID, props.status)
          if (!options?.managedSession || managedSessions.get(props.sessionID) !== false)
            void sync(props.sessionID, { force: true }).catch(() => {})
          return
        }
        setExecutionStatus(props.sessionID, props.status)
        return
      }
      case "session.next.revert.staged":
      case "session.next.revert.cleared":
      case "session.next.revert.committed": {
        const props = event.properties as {
          sessionID: string
          revert?: Session["revert"]
          replacement?: { agent: string; model: Session["model"] }
        }
        const info = data.info[props.sessionID]
        if (info)
          setData(
            "info",
            props.sessionID,
            reconcile({
              ...info,
              revert: event.type === "session.next.revert.staged" ? props.revert : undefined,
              ...(event.type === "session.next.revert.committed" && props.replacement
                ? { agent: props.replacement.agent, model: props.replacement.model }
                : {}),
            }),
          )
        const refresh = () => sync(props.sessionID, { force: true })
        void (inflight.get(props.sessionID)?.then(refresh) ?? refresh()).catch(() => {})
        return
      }
      case "session.next.step.ended":
      case "session.next.step.failed": {
        const props = event.properties as {
          assistantMessageID: string
          timestamp: number
          cost?: number
          tokens?: Extract<Message, { role: "assistant" }>["tokens"]
          finish?: string
          error?: Extract<Message, { role: "assistant" }>["error"]
        }
        updateV2Assistant(props.assistantMessageID, eventID, {
          time: {
            completed: props.timestamp,
            created: v2Assistant(props.assistantMessageID, eventID)?.time.created ?? props.timestamp,
          },
          ...(event.type === "session.next.step.ended"
            ? {
                cost: props.cost ?? 0,
                tokens: props.tokens ?? v2Assistant(props.assistantMessageID, eventID)?.tokens,
                finish: props.finish,
              }
            : { error: props.error }),
        })
        if (eventID) void sync(eventID, { force: true }).catch(() => {})
        return
      }
      case "session.next.step.started": {
        const props = event.properties as {
          sessionID: string
          assistantMessageID: string
          timestamp: number
          agent: string
          model: { providerID: string; id: string; variant?: string }
        }
        ensureV2Assistant(props)
        return
      }
      case "session.next.text.started":
      case "session.next.reasoning.started": {
        const props = event.properties as {
          sessionID: string
          assistantMessageID: string
          timestamp: number
          textID?: string
          reasoningID?: string
        }
        const assistant = v2Assistant(props.assistantMessageID, props.sessionID)
        if (!assistant) return
        const partID = props.textID ?? props.reasoningID!
        upsertV2Part(
          props.textID
            ? { id: partID, sessionID: props.sessionID, messageID: assistant.id, type: "text", text: "" }
            : {
                id: partID,
                sessionID: props.sessionID,
                messageID: assistant.id,
                type: "reasoning",
                text: "",
                time: { start: props.timestamp },
              },
        )
        return
      }
      case "session.next.text.delta":
      case "session.next.reasoning.delta": {
        const props = event.properties as {
          messageID?: string
          assistantMessageID: string
          textID?: string
          reasoningID?: string
          delta: string
        }
        const partID = props.textID ?? props.reasoningID
        if (!partID) return
        const parts = data.part[props.assistantMessageID]
        const result = parts ? Binary.search(parts, partID, (part) => part.id) : undefined
        if (!result?.found) return
        const part = parts[result.index]
        if (part.type !== "text" && part.type !== "reasoning") return
        upsertV2Part({ ...part, text: `${part.text}${props.delta}` })
        return
      }
      case "session.next.text.ended":
      case "session.next.reasoning.ended": {
        const props = event.properties as {
          assistantMessageID: string
          textID?: string
          reasoningID?: string
          text: string
          timestamp: number
        }
        const partID = props.textID ?? props.reasoningID
        if (!partID) return
        const parts = data.part[props.assistantMessageID]
        const result = parts ? Binary.search(parts, partID, (part) => part.id) : undefined
        if (!result?.found) return
        const part = parts[result.index]
        if (part.type === "text") upsertV2Part({ ...part, text: props.text })
        if (part.type === "reasoning")
          upsertV2Part({ ...part, text: props.text, time: { ...part.time, end: props.timestamp } })
        return
      }
      case "session.next.tool.input.started": {
        const props = event.properties as {
          sessionID: string
          assistantMessageID: string
          callID: string
          name?: string
          timestamp: number
        }
        const assistant = v2Assistant(props.assistantMessageID, props.sessionID)
        if (!assistant) return
        upsertV2Part({
          id: props.callID,
          sessionID: props.sessionID,
          messageID: assistant.id,
          type: "tool",
          callID: props.callID,
          tool: props.name ?? "",
          state: { status: "pending", input: {}, raw: "" },
        })
        return
      }
      case "session.next.tool.input.delta": {
        const props = event.properties as { assistantMessageID: string; callID: string; delta: string }
        const part = data.part[props.assistantMessageID]?.find((item) => item.id === props.callID)
        if (!part || part.type !== "tool" || part.state.status !== "pending") return
        upsertV2Part({ ...part, state: { ...part.state, raw: part.state.raw + props.delta } })
        return
      }
      case "session.next.tool.input.ended": {
        const props = event.properties as { assistantMessageID: string; callID: string; text: string }
        const part = data.part[props.assistantMessageID]?.find((item) => item.id === props.callID)
        if (!part || part.type !== "tool" || part.state.status !== "pending") return
        upsertV2Part({ ...part, state: { ...part.state, input: parseToolInput(props.text), raw: props.text } })
        return
      }
      case "session.next.tool.called": {
        const props = event.properties as {
          sessionID: string
          assistantMessageID: string
          callID: string
          tool: string
          input: Record<string, unknown>
          timestamp: number
        }
        const part = data.part[props.assistantMessageID]?.find((item) => item.id === props.callID)
        if (!part || part.type !== "tool") return
        upsertV2Part({
          ...part,
          tool: props.tool,
          state: { status: "running", input: props.input, time: { start: props.timestamp } },
        })
        return
      }
      case "session.next.tool.progress": {
        const props = event.properties as {
          assistantMessageID: string
          callID: string
          structured: Record<string, unknown>
          content: unknown[]
        }
        const part = data.part[props.assistantMessageID]?.find((item) => item.id === props.callID)
        if (!part || part.type !== "tool" || part.state.status !== "running") return
        upsertV2Part({
          ...part,
          state: {
            ...part.state,
            title: part.tool,
            metadata: { structured: props.structured, content: props.content },
          },
        })
        return
      }
      case "session.next.tool.success": {
        const props = event.properties as {
          assistantMessageID: string
          callID: string
          structured: Record<string, unknown>
          content: unknown[]
          timestamp: number
        }
        const part = data.part[props.assistantMessageID]?.find((item) => item.id === props.callID)
        if (!part || part.type !== "tool") return
        const input = part.state.status === "running" ? part.state.input : part.state.input
        upsertV2Part({
          ...part,
          state: {
            status: "completed",
            input,
            output: JSON.stringify(props.content),
            title: part.tool,
            metadata: { structured: props.structured },
            time: {
              start: part.state.status === "running" ? part.state.time.start : props.timestamp,
              end: props.timestamp,
            },
          },
        })
        return
      }
      case "session.next.tool.failed": {
        const props = event.properties as {
          assistantMessageID: string
          callID: string
          error: { message: string }
          timestamp: number
        }
        const part = data.part[props.assistantMessageID]?.find((item) => item.id === props.callID)
        if (!part || part.type !== "tool") return
        const input = part.state.status === "running" ? part.state.input : part.state.input
        upsertV2Part({
          ...part,
          state: {
            status: "error",
            input,
            error: props.error.message,
            time: {
              start: part.state.status === "running" ? part.state.time.start : props.timestamp,
              end: props.timestamp,
            },
          },
        })
        return
      }
      case "message.updated": {
        const info = cleanMessage((event.properties as { info: Message }).info)
        const load = messageLoads.get(info.sessionID)
        load?.touchedMessages.add(info.id)
        load?.removedMessages.delete(info.id)
        const items = optimistic.get(info.sessionID)
        const item = items?.get(info.id)
        if (items && item) {
          if (item.parts.length === 0) clearOptimistic(info.sessionID, info.id)
          if (item.parts.length > 0) items.set(info.id, { ...item, confirmedMessage: true })
        }
        const orphans = orphanParts.get(info.sessionID)
        orphans?.delete(info.id)
        if (orphans?.size === 0) orphanParts.delete(info.sessionID)
        const removedMessagesForSession = removedMessages.get(info.sessionID)
        removedMessagesForSession?.delete(info.id)
        if (removedMessagesForSession?.size === 0) removedMessages.delete(info.sessionID)
        const order = messageOrder.get(info.sessionID)
        if (order && !order.includes(info.id)) messageOrder.set(info.sessionID, [...order, info.id])
        const messages = data.message[info.sessionID]
        if (!messages) {
          setData("message", info.sessionID, [info])
          return
        }
        const result = Binary.search(messages, info.id, (message) => message.id)
        if (result.found) setData("message", info.sessionID, result.index, reconcile(info))
        if (!result.found)
          setData("message", info.sessionID, (value = []) => {
            const next = value.slice()
            next.splice(result.index, 0, info)
            return next
          })
        return
      }
      case "message.removed": {
        const props = event.properties as { sessionID: string; messageID: string }
        const load = messageLoads.get(props.sessionID)
        load?.touchedMessages.add(props.messageID)
        load?.removedMessages.add(props.messageID)
        load?.clearedMessageParts.add(props.messageID)
        load?.deltaParts.delete(props.messageID)
        load?.carriedDeltaParts.delete(props.messageID)
        load?.removedParts.delete(props.messageID)
        load?.optimisticParts.delete(props.messageID)
        pendingParts.get(props.sessionID)?.delete(props.messageID)
        if (pendingParts.get(props.sessionID)?.size === 0) pendingParts.delete(props.sessionID)
        const removedMessagesForSession = removedMessages.get(props.sessionID) ?? new Set<string>()
        removedMessagesForSession.add(props.messageID)
        removedMessages.set(props.sessionID, removedMessagesForSession)
        clearOptimistic(props.sessionID, props.messageID)
        const order = messageOrder.get(props.sessionID)
        if (order) messageOrder.set(props.sessionID, order.filter((id) => id !== props.messageID))
        setData(
          produce((draft) => {
            const messages = draft.message[props.sessionID]
            if (messages) {
              const result = Binary.search(messages, props.messageID, (message) => message.id)
              if (result.found) messages.splice(result.index, 1)
            }
            deleteMessageParts(draft, props.messageID)
          }),
        )
        return
      }
      case "message.part.updated": {
        const part = (event.properties as { part: Part }).part
        if (SKIP_PARTS.has(part.type)) return
        const messages = data.message[part.sessionID]
        const load = messageLoads.get(part.sessionID)
        const missing = !messages || !Binary.search(messages, part.messageID, (message) => message.id).found
        // Outside a page load, accepting a part without its ordered parent event would create an unbounded orphan.
        if (
          missing &&
          (!load ||
            load.clearedMessageParts.has(part.messageID) ||
            removedMessages.get(part.sessionID)?.has(part.messageID))
        )
          return
        if (missing) {
          const orphans = orphanParts.get(part.sessionID) ?? new Set<string>()
          orphans.add(part.messageID)
          orphanParts.set(part.sessionID, orphans)
          load?.orphanParents.add(part.messageID)
        }
        const deltas = load?.deltaParts.get(part.messageID)
        deltas?.delete(part.id)
        if (deltas?.size === 0) load?.deltaParts.delete(part.messageID)
        const carried = load?.carriedDeltaParts.get(part.messageID)
        carried?.delete(part.id)
        if (carried?.size === 0) load?.carriedDeltaParts.delete(part.messageID)
        const removed = load?.removedParts.get(part.messageID)
        removed?.delete(part.id)
        if (removed?.size === 0) load?.removedParts.delete(part.messageID)
        const pending = pendingParts.get(part.sessionID)?.get(part.messageID)
        pending?.delete(part.id)
        if (pending?.size === 0) pendingParts.get(part.sessionID)?.delete(part.messageID)
        if (pendingParts.get(part.sessionID)?.size === 0) pendingParts.delete(part.sessionID)
        const optimistic = load?.optimisticParts.get(part.messageID)
        optimistic?.delete(part.id)
        if (optimistic?.size === 0) load?.optimisticParts.delete(part.messageID)
        deltaBases.delete(part.id)
        trackPartChange(part.sessionID, part.messageID, part.id)
        confirmOptimisticPart(part.sessionID, part.messageID, part)
        setData(
          "part_text_accum_delta",
          produce((draft) => void delete draft[part.id]),
        )
        const parts = data.part[part.messageID]
        if (!parts) {
          setData("part", part.messageID, [part])
          return
        }
        const result = Binary.search(parts, part.id, (item) => item.id)
        if (result.found) setData("part", part.messageID, result.index, reconcile(part))
        if (!result.found)
          setData("part", part.messageID, (value = []) => {
            const next = value.slice()
            next.splice(result.index, 0, part)
            return next
          })
        return
      }
      case "message.part.removed": {
        const props = event.properties as { sessionID: string; messageID: string; partID: string }
        // Part removal is event-only on the server, so its tombstone lasts until a later update or eviction.
        const pending = pendingParts.get(props.sessionID) ?? new Map<string, Set<string>>()
        const parts = pending.get(props.messageID) ?? new Set<string>()
        parts.add(props.partID)
        pending.set(props.messageID, parts)
        pendingParts.set(props.sessionID, pending)
        const deltas = messageLoads.get(props.sessionID)?.deltaParts.get(props.messageID)
        deltas?.delete(props.partID)
        if (deltas?.size === 0) messageLoads.get(props.sessionID)?.deltaParts.delete(props.messageID)
        const load = messageLoads.get(props.sessionID)
        const carried = load?.carriedDeltaParts.get(props.messageID)
        carried?.delete(props.partID)
        if (carried?.size === 0) load?.carriedDeltaParts.delete(props.messageID)
        if (load) {
          const parts = load.removedParts.get(props.messageID) ?? new Set<string>()
          parts.add(props.partID)
          load.removedParts.set(props.messageID, parts)
          const optimistic = load.optimisticParts.get(props.messageID)
          optimistic?.delete(props.partID)
          if (optimistic?.size === 0) load.optimisticParts.delete(props.messageID)
        }
        trackPartChange(props.sessionID, props.messageID, props.partID)
        clearOptimisticPart(props.sessionID, props.messageID, props.partID)
        setData(
          produce((draft) => {
            delete draft.part_text_accum_delta[props.partID]
            deltaBases.delete(props.partID)
            const parts = draft.part[props.messageID]
            if (!parts) return
            const result = Binary.search(parts, props.partID, (part) => part.id)
            if (result.found) parts.splice(result.index, 1)
            if (draft.part_order[props.messageID])
              draft.part_order[props.messageID] = draft.part_order[props.messageID].filter((id) => id !== props.partID)
            if (parts.length === 0) deleteMessageParts(draft, props.messageID)
          }),
        )
        return
      }
      case "message.part.delta": {
        const props = event.properties as {
          sessionID: string
          messageID: string
          partID: string
          field: string
          delta: string
        }
        const parts = data.part[props.messageID]
        if (!parts) return
        const result = Binary.search(parts, props.partID, (part) => part.id)
        if (!result.found) return
        trackPartChange(props.sessionID, props.messageID, props.partID)
        const load = messageLoads.get(props.sessionID)
        if (load) {
          const parts = load.deltaParts.get(props.messageID) ?? new Set<string>()
          parts.add(props.partID)
          load.deltaParts.set(props.messageID, parts)
          const carried = load.carriedDeltaParts.get(props.messageID)
          carried?.delete(props.partID)
          if (carried?.size === 0) load.carriedDeltaParts.delete(props.messageID)
        }
        const field = props.field as keyof (typeof parts)[number]
        const current = parts[result.index]?.[field]
        if (!deltaBases.has(props.partID) && typeof current === "string")
          deltaBases.set(props.partID, { base: current, sessionID: props.sessionID })
        setData(
          "part_text_accum_delta",
          props.partID,
          (value) => (value ?? (typeof current === "string" ? current : "")) + props.delta,
        )
        setData(
          "part",
          props.messageID,
          produce((draft) => {
            if (!draft) return
            const part = draft[result.index]
            const field = props.field as keyof typeof part
            ;(part[field] as string) = ((part[field] as string | undefined) ?? "") + props.delta
          }),
        )
        return
      }
      case "permission.asked": {
        const permission = event.properties as PermissionRequest
        const permissions = data.permission[permission.sessionID]
        if (!permissions) {
          setData("permission", permission.sessionID, [permission])
          return
        }
        const result = Binary.search(permissions, permission.id, (item) => item.id)
        if (result.found) setData("permission", permission.sessionID, result.index, reconcile(permission))
        if (!result.found)
          setData(
            "permission",
            permission.sessionID,
            produce((draft) => void draft.splice(result.index, 0, permission)),
          )
        return
      }
      case "permission.replied": {
        const props = event.properties as { sessionID: string; requestID: string }
        setData(
          "permission",
          props.sessionID,
          produce((draft) => {
            if (!draft) return
            const result = Binary.search(draft, props.requestID, (item) => item.id)
            if (result.found) draft.splice(result.index, 1)
          }),
        )
        return
      }
      case "question.v2.asked":
      case "question.asked": {
        const question = {
          ...(event.properties as QuestionRequest),
          appRuntime: event.type === "question.v2.asked" ? "canonical" : "legacy",
        }
        const questions = data.question[question.sessionID]
        if (!questions) {
          setData("question", question.sessionID, [question])
          return
        }
        const result = Binary.search(questions, question.id, (item) => item.id)
        if (result.found) setData("question", question.sessionID, result.index, reconcile(question))
        if (!result.found)
          setData(
            "question",
            question.sessionID,
            produce((draft) => void draft.splice(result.index, 0, question)),
          )
        return
      }
      case "question.replied":
      case "question.v2.replied":
      case "question.v2.rejected":
      case "question.rejected": {
        const props = event.properties as { sessionID: string; requestID: string }
        setData(
          "question",
          props.sessionID,
          produce((draft) => {
            if (!draft) return
            const result = Binary.search(draft, props.requestID, (item) => item.id)
            if (result.found) draft.splice(result.index, 1)
          }),
        )
      }
    }
  }

  return {
    data,
    set: setData,
    get: (sessionID: string) => data.info[sessionID],
    peek: (sessionID: string) => data.info[sessionID],
    remember,
    parts: orderedParts,
    resolve,
    lineage: {
      peek: peekLineage,
      async resolve(sessionID: string) {
        const session = await resolve(sessionID)
        return { session, root: await rootSession(session, resolve) }
      },
    },
    sync,
    prefetch,
    timeline,
    shouldPrefetch(sessionID: string, limit: number) {
      if (data.message[sessionID] === undefined) return true
      if (Date.now() - (meta.at[sessionID] ?? 0) > 15_000) return true
      if (meta.complete[sessionID]) return false
      return (meta.limit[sessionID] ?? 0) <= limit
    },
    fresh(sessionID: string, ttl: number) {
      return Date.now() - (meta.at[sessionID] ?? 0) <= ttl
    },
    optimistic: {
      add(input: { sessionID: string; message: Message; parts: Part[] }) {
        const parts = input.parts
          .filter((part) => !!part?.id && !SKIP_PARTS.has(part.type))
          .sort((a, b) => cmp(a.id, b.id))
        const load = messageLoads.get(input.sessionID)
        if (load?.clearedMessageParts.has(input.message.id)) {
          const touched = load.touchedParts.get(input.message.id) ?? new Set<string>()
          parts.forEach((part) => touched.add(part.id))
          load.touchedParts.set(input.message.id, touched)
        }
        if (load) {
          load.removedMessages.delete(input.message.id)
          load.optimisticParts.set(input.message.id, new Set(parts.map((part) => part.id)))
        }
        const items = optimistic.get(input.sessionID)
        const removedMessagesForSession = removedMessages.get(input.sessionID)
        removedMessagesForSession?.delete(input.message.id)
        if (removedMessagesForSession?.size === 0) removedMessages.delete(input.sessionID)
        if (items) items.set(input.message.id, { ...input, parts, confirmedParts: [] })
        if (!items)
          optimistic.set(input.sessionID, new Map([[input.message.id, { ...input, parts, confirmedParts: [] }]]))
        const order = messageOrder.get(input.sessionID)
        if (order && !order.includes(input.message.id)) messageOrder.set(input.sessionID, [...order, input.message.id])
        setData("message", input.sessionID, (messages = []) => merge(messages, [input.message]))
        setData(
          "part_text_accum_delta",
          produce((draft) => {
            for (const part of [...(data.part[input.message.id] ?? []), ...parts]) {
              delete draft[part.id]
              deltaBases.delete(part.id)
            }
          }),
        )
        setData("part", input.message.id, parts)
      },
      remove(input: { sessionID: string; messageID: string }) {
        const item = optimistic.get(input.sessionID)?.get(input.messageID)
        if (!item) return
        messageLoads.get(input.sessionID)?.optimisticParts.delete(input.messageID)
        clearOptimistic(input.sessionID, input.messageID)
        if (item.confirmedMessage) {
          const partIDs = new Set(item.parts.map((part) => part.id))
          setData(
            produce((draft) => {
              for (const part of item.parts) {
                delete draft.part_text_accum_delta[part.id]
                deltaBases.delete(part.id)
              }
              const parts = draft.part[input.messageID]
              if (!parts) return
              draft.part[input.messageID] = parts.filter((part) => !partIDs.has(part.id))
              if (draft.part[input.messageID]?.length === 0) delete draft.part[input.messageID]
            }),
          )
          return
        }
        setData("message", input.sessionID, (messages) => messages?.filter((message) => message.id !== input.messageID))
        const order = messageOrder.get(input.sessionID)
        if (order) messageOrder.set(input.sessionID, order.filter((id) => id !== input.messageID))
        setData(produce((draft) => deleteMessageParts(draft, input.messageID)))
      },
    },
    diff(sessionID: string, options?: { force?: boolean }) {
      touch(sessionID)
      if (data.session_diff[sessionID] !== undefined && !options?.force) return Promise.resolve()
      return runInflight(inflightDiff, sessionID, () => {
        const active = generation(sessionID)
        return retry(() => client.session.diff({ sessionID })).then((result) => {
          if (generations.get(sessionID) !== active) return
          setData("session_diff", sessionID, reconcile(cleanDiffs(result.data), { key: "file" }))
        })
      })
    },
    todo(sessionID: string, options?: { force?: boolean }) {
      touch(sessionID)
      if (data.todo[sessionID] !== undefined && !options?.force) return Promise.resolve()
      return runInflight(inflightTodo, sessionID, () => {
        const active = generation(sessionID)
        return retry(() => client.session.todo({ sessionID })).then((result) => {
          if (generations.get(sessionID) !== active) return
          setData("todo", sessionID, reconcile(result.data ?? [], { key: "id" }))
        })
      })
    },
    history: {
      more: (sessionID: string) =>
        data.message[sessionID] !== undefined &&
        meta.limit[sessionID] !== undefined &&
        !meta.complete[sessionID] &&
        !!meta.cursor[sessionID],
      loading: (sessionID: string) => meta.loading[sessionID] ?? false,
      async loadMore(sessionID: string, count = historyMessagePageSize) {
        touch(sessionID)
        if (meta.loading[sessionID] || meta.complete[sessionID] || !meta.cursor[sessionID]) return
        await loadMessages(sessionID, count, meta.cursor[sessionID], "prepend")
      },
    },
    evict(sessionID: string) {
      if (protectedSessions().has(sessionID)) return
      seen.delete(sessionID)
      evict([sessionID])
    },
    pin(sessionID: string) {
      pinned.set(sessionID, (pinned.get(sessionID) ?? 0) + 1)
      touch(sessionID)
    },
    unpin(sessionID: string) {
      const count = pinned.get(sessionID)
      if (!count || count === 1) pinned.delete(sessionID)
      if (count && count > 1) pinned.set(sessionID, count - 1)
    },
    apply,
    executionSnapshotToken() {
      return new Map(executionRevisions)
    },
    reconcileExecutionSnapshot(snapshot: Record<string, ExecutionStatus>, token: ReadonlyMap<string, number>) {
      const failed: string[] = []
      for (const sessionID of Object.keys(snapshot)) v2Sessions.add(sessionID)
      const sessionIDs = new Set(v2Sessions)
      for (const sessionID of sessionIDs) {
        if ((executionRevisions.get(sessionID) ?? 0) !== (token.get(sessionID) ?? 0)) continue
        const status = snapshot[sessionID] ?? { type: "idle" as const }
        setExecutionStatus(sessionID, status)
        if (status.type === "failed") failed.push(status.error.message)
      }
      return failed
    },
  }
}

export type ServerSession = ReturnType<typeof createServerSession>
