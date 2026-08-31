import type { Sync } from "@hena/schema/sync"
import type { AppType } from "@hena/server-v3/protocol"
import { hc } from "hono/client"
import { createLocalMessages } from "./local-messages"
import { createConnectionStore, type Change, type ScopeRef } from "./store"

export type ConnectionStatus = "idle" | "connecting" | "live" | "reconnecting" | "upgrade-required" | "unauthorized" | "error"
export type RpcClient = ReturnType<typeof hc<AppType>>
export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
export interface ConnectionAgent {
  readonly url: string
  readonly client: RpcClient
  readonly store: ReturnType<typeof createConnectionStore>
  readonly localMessages: ReturnType<typeof createLocalMessages>
  readonly status: ConnectionStatus
  readonly lastSyncAt: number | undefined
  readonly errorMessage: string | undefined
  subscribe(listener: () => void): () => boolean
  start(): Promise<void>
  claim(sessionId: string): () => void
  retry(): void
  dispose(): void
}

type StreamResource = Sync.StreamResource
type StreamFrame = Sync.StreamFrame
type Snapshot = {
  scope: ScopeRef
  baseSeq: number
  replace: boolean
  rows: Sync.SnapshotRow[]
  bufferedRows: Sync.RowsFrame[]
}
type Decoders = Awaited<ReturnType<typeof loadDecoders>>

const SessionCollections = ["messages", "parts", "sessionInputs", "todos"] as const
const VolatileCollections = new Set(["permissions", "questions", "agents", "models", "providers"])
const LingeredSessions = 8

export function createConnectionAgent(url: string, fetcher: Fetcher = fetch): ConnectionAgent {
  let refresh = (_scopes?: readonly ScopeRef[]) => {}
  const store = createConnectionStore({ onTxidTimeout: (scopes) => refresh(scopes) })
  const localMessages = createLocalMessages()
  const client = hc<AppType>(url, {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => fetcher(input, {
      ...init,
      headers: { ...Object.fromEntries(new Headers(init?.headers).entries()), "x-correlation-id": crypto.randomUUID() },
    }),
  })
  const listeners = new Set<() => void>()
  const linger = new Array<string>()
  let focusedSession: string | undefined
  let status: ConnectionStatus = "idle"
  let lastSyncAt: number | undefined
  let errorMessage: string | undefined
  let resource: StreamResource | undefined
  let abort: AbortController | undefined
  let startPromise: Promise<void> | undefined
  let subscriptionRevision = 0
  let disposed = false
  let restartRevision = 0
  let decoders: Decoders | undefined

  const notify = () => listeners.forEach((listener) => listener())
  const setStatus = (next: ConnectionStatus) => {
    if (status === next) return
    status = next
    notify()
  }
  const touch = () => {
    lastSyncAt = Date.now()
    notify()
  }
  const claimedSessions = () => Array.from(new Set([focusedSession, ...linger].filter((session): session is string => !!session)))
  const requestRestart = () => {
    restartRevision++
    abort?.abort()
  }
  refresh = (scopes) => {
    store.dropCursors(scopes)
    requestRestart()
  }

  async function start() {
    if (startPromise) return startPromise
    disposed = false
    startPromise = run().finally(() => { startPromise = undefined })
    return startPromise
  }

  async function run() {
    setStatus("connecting")
    decoders ??= await loadDecoders()
    let attempt = 0
    while (!disposed) {
      const currentRestartRevision = restartRevision
      try {
        if (!resource) await createResource()
        if (!resource) continue
        if (!await putSubscription()) continue
        if (currentRestartRevision !== restartRevision) continue
        await attach(resource.generation)
        if (disposed) return
        if (currentRestartRevision !== restartRevision) continue
        setStatus("reconnecting")
        await reconnectDelay(attempt++)
      } catch (cause) {
        if (disposed) return
        if (cause instanceof TerminalError) {
          errorMessage = cause.message
          setStatus(cause.status)
          return
        }
        if (currentRestartRevision !== restartRevision || (cause instanceof DOMException && cause.name === "AbortError")) continue
        setStatus("reconnecting")
        await reconnectDelay(attempt++)
      }
    }
  }

  async function createResource() {
    setStatus(status === "idle" ? "connecting" : status)
    const capabilities = decoders!.capabilities(await getJson(await client.api.collection.capabilities.$get()))
    if (!capabilities) throw new TerminalError("error")
    if (capabilities.protocol.min > 1 || capabilities.protocol.max < 1) throw new TerminalError("upgrade-required")
    if (capabilities.auth === "required") throw new TerminalError("unauthorized")
    const decoded = decoders!.stream(await getJson(await client.api.collection.streams.$post()))
    if (!decoded) throw new TerminalError("error")
    resource = decoded
    subscriptionRevision = Math.max(subscriptionRevision, decoded.subscriptionRevision)
    const expiredScopes = store.scopeRefs().filter((scope) => {
      const cursor = store.cursor(scope.collection, scope.scopeKey)
      return cursor > 0 && cursor < decoded.feed.retainedFloor
    })
    store.dropCursors(expiredScopes)
  }

  async function putSubscription() {
    if (!resource) return false
    subscriptionRevision = Math.max(subscriptionRevision, resource.subscriptionRevision) + 1
    const cursors = Object.fromEntries(store.scopeRefs().flatMap((scope) => {
      if (VolatileCollections.has(scope.collection)) return []
      const seq = store.cursor(scope.collection, scope.scopeKey)
      return seq > 0 ? [[`${scope.collection}:${scope.scopeKey}`, { feedId: resource!.feed.feedId, seq }] as const] : []
    }))
    const response = await client.api.collection.streams[":streamId"].subscription.$put({
      param: { streamId: resource.streamId },
      json: { revision: subscriptionRevision, lists: true, sessions: claimedSessions(), cursors },
    })
    if (response.status === 404) {
      resource = undefined
      return false
    }
    if (!response.ok) {
      const error = decoders!.error(await response.json())
      if (error?.error.code === "subscription_revision_conflict") {
        resource = undefined
        return false
      }
      if (error?.error.code === "unsupported_protocol") throw new TerminalError("upgrade-required")
      if (error?.error.code === "unauthorized") throw new TerminalError("unauthorized")
      throw new Error(`Subscription failed with ${response.status}`)
    }
    const accepted = decoders!.subscription(await response.json())
    if (!accepted) throw new TerminalError("error")
    resource = { ...resource, generation: accepted.generation }
    return true
  }

  async function attach(generation: number) {
    if (!resource) return
    const applyFrame = createFrameApplier()
    abort = new AbortController()
    let liveness: ReturnType<typeof setTimeout> | undefined
    let livenessExpired = false
    let attachmentGeneration: number | undefined
    const resetLiveness = () => {
      if (liveness) clearTimeout(liveness)
      liveness = setTimeout(() => {
        livenessExpired = true
        abort?.abort()
      }, 45_000)
    }
    resetLiveness()
    try {
      const response = await fetcher(`${url}/api/collection/streams/${resource.streamId}/events`, {
        headers: { accept: "text/event-stream", "x-correlation-id": crypto.randomUUID() },
        signal: abort.signal,
      })
      if (response.status === 404) {
        resource = undefined
        requestRestart()
        return
      }
      if (!response.ok || !response.body) throw new Error(`Event stream failed with ${response.status}`)
      for await (const event of parseEventStream(response.body)) {
        if (disposed) return
        resetLiveness()
        const decoded = decoders!.frame(event.data)
        if (!decoded) throw new TerminalError("error", `Malformed collection frame: ${event.data.slice(0, 500)}`)
        if (!resource || decoded.streamId !== resource.streamId || decoded.generation < generation) continue
        if (attachmentGeneration !== undefined && decoded.generation !== attachmentGeneration) continue
        attachmentGeneration ??= decoded.generation
        if (resource.generation !== decoded.generation) resource = { ...resource, generation: decoded.generation }
        if (decoded.feedId !== resource.feed.feedId) {
          localMessages.clear()
          store.clear()
          resource = undefined
          requestRestart()
          return
        }
        if (decoded.runtimeId !== resource.feed.runtimeId)
          resource = { ...resource, feed: { ...resource.feed, runtimeId: decoded.runtimeId } }
        applyFrame(decoded)
        touch()
        setStatus("live")
      }
    } finally {
      if (liveness) clearTimeout(liveness)
      abort = undefined
    }
    if (livenessExpired) throw new Error("Collection stream became silent")
  }

  function createFrameApplier() {
    const snapshots = new Map<string, Snapshot>()
    const activeSnapshots = new Map<string, string>()
    const bufferedDeltas = new Map<string, Sync.DeltaFrame[]>()

    function applyRows(frame: Sync.RowsFrame) {
      store.applyRows({ throughSeq: frame.throughSeq, changes: frame.changes as readonly Change[] })
      new Set(frame.changes.map((change) => change.scopeKey)).forEach((sessionId) => localMessages.reconcile(store, sessionId))
    }

    function applyFrame(frame: StreamFrame) {
      if (frame.type === "heartbeat" || frame.type === "stream.ready") return
      if (frame.type === "error") {
        if (frame.code === "unsupported_protocol") throw new TerminalError("upgrade-required")
        if (frame.code === "unauthorized") throw new TerminalError("unauthorized")
        if (frame.code === "subscription_revision_conflict") resource = undefined
        if (frame.code === "snapshot_required") store.dropCursors(frame.scopes)
        if (["slow_consumer", "subscription_revision_conflict", "snapshot_required"].includes(frame.code)) {
          requestRestart()
          return
        }
        throw new TerminalError("error")
      }
      if (frame.type === "snapshot.begin") {
        const identity = scopeIdentity(frame.scope)
        if (activeSnapshots.has(identity) || snapshots.has(frame.snapshotId)) throw new TerminalError("error")
        snapshots.set(frame.snapshotId, {
          scope: frame.scope,
          baseSeq: frame.baseSeq,
          replace: frame.replace,
          rows: [],
          bufferedRows: [],
        })
        activeSnapshots.set(identity, frame.snapshotId)
        return
      }
      if (frame.type === "snapshot.page") {
        const snapshot = snapshots.get(frame.snapshotId)
        if (!snapshot || scopeIdentity(snapshot.scope) !== scopeIdentity(frame.scope)) throw new TerminalError("error")
        snapshot.rows.push(...frame.rows)
        return
      }
      if (frame.type === "snapshot.end") {
        const snapshot = snapshots.get(frame.snapshotId)
        if (!snapshot || scopeIdentity(snapshot.scope) !== scopeIdentity(frame.scope)) throw new TerminalError("error")
        const keys = new Set(snapshot.rows.map((row) => wireKey(row.key)))
        if (keys.size !== frame.keyCount || snapshot.rows.length !== frame.keyCount || snapshot.baseSeq !== frame.throughSeq)
          throw new TerminalError("error")
        store.applySnapshot(snapshot.scope.collection, snapshot.scope.scopeKey, snapshot.rows, frame.throughSeq, snapshot.replace)
        localMessages.reconcile(store, snapshot.scope.scopeKey)
        snapshots.delete(frame.snapshotId)
        activeSnapshots.delete(scopeIdentity(snapshot.scope))
        snapshot.bufferedRows.forEach((rows) => applyRows({
          ...rows,
          changes: rows.changes.filter((change) => change.seq > frame.throughSeq),
        }))
        flushDeltas(snapshot.scope.scopeKey)
        return
      }
      if (frame.type === "rows") {
        const buffered = new Set<string>()
        frame.changes.forEach((change) => {
          const snapshotId = activeSnapshots.get(scopeIdentity(change))
          if (!snapshotId || buffered.has(snapshotId)) return
          snapshots.get(snapshotId)?.bufferedRows.push(frame)
          buffered.add(snapshotId)
        })
        const changes = frame.changes.filter((change) => !activeSnapshots.has(scopeIdentity(change)))
        if (changes.length > 0) applyRows({ ...frame, changes })
        return
      }
      if (!claimedSessions().includes(frame.sessionId)) return
      if (sessionHasSnapshot(frame.sessionId)) {
        const pending = bufferedDeltas.get(frame.sessionId) ?? []
        pending.push(frame)
        bufferedDeltas.set(frame.sessionId, pending)
        return
      }
      store.applyDelta(frame)
    }

    function sessionHasSnapshot(sessionId: string) {
      return SessionCollections.some((collection) => activeSnapshots.has(scopeIdentity({ collection, scopeKey: sessionId })))
    }

    function flushDeltas(sessionId: string) {
      if (sessionHasSnapshot(sessionId)) return
      bufferedDeltas.get(sessionId)?.forEach((delta) => store.applyDelta(delta))
      bufferedDeltas.delete(sessionId)
    }

    return applyFrame
  }

  return {
    url,
    client,
    store,
    localMessages,
    get status() { return status },
    get lastSyncAt() { return lastSyncAt },
    get errorMessage() { return errorMessage },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start,
    claim(sessionId: string) {
      const previous = focusedSession
      focusedSession = sessionId
      remove(linger, sessionId)
      if (previous && previous !== sessionId) retain(previous)
      requestRestart()
      return () => {
        if (focusedSession !== sessionId) return
        focusedSession = undefined
        retain(sessionId)
        requestRestart()
      }
    },
    retry() {
      if (!["upgrade-required", "unauthorized", "error"].includes(status)) return
      resource = undefined
      setStatus("reconnecting")
      void start()
    },
    dispose() {
      disposed = true
      abort?.abort()
      localMessages.dispose()
      store.dispose()
      setStatus("idle")
    },
  }

  function retain(sessionId: string) {
    remove(linger, sessionId)
    linger.unshift(sessionId)
    linger.splice(LingeredSessions).forEach((evicted) => {
      localMessages.dropSession(evicted)
      store.dropSession(evicted)
    })
  }
}

export async function* parseEventStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let pending = ""
  while (true) {
    const result = await reader.read()
    pending += decoder.decode(result.value, { stream: !result.done })
    const records = pending.split(/\r?\n\r?\n/)
    pending = records.pop() ?? ""
    for (const record of records) {
      let event = "message"
      const data: string[] = []
      record.split(/\r?\n/).forEach((line) => {
        if (line.startsWith("event:")) event = line.slice(6).trimStart()
        if (line.startsWith("data:")) data.push(line.slice(5).trimStart())
      })
      if (data.length > 0) yield { event, data: data.join("\n") }
    }
    if (result.done) return
  }
}

async function loadDecoders() {
  const [{ Sync }, { Schema }] = await Promise.all([import("@hena/schema/sync"), import("effect")])
  const option = <Value>(decode: (value: unknown) => { _tag: string; value?: Value }) => (value: unknown) => {
    const result = decode(value)
    return result._tag === "Some" ? result.value : undefined
  }
  const json = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
  const frame = Schema.decodeUnknownOption(Sync.StreamFrame)
  return {
    capabilities: option(Schema.decodeUnknownOption(Sync.Capabilities)),
    stream: option(Schema.decodeUnknownOption(Sync.StreamResource)),
    subscription: option(Schema.decodeUnknownOption(Sync.SubscriptionAccepted)),
    error: option(Schema.decodeUnknownOption(Sync.ErrorResponse)),
    frame: (value: string) => {
      const parsed = json(value)
      if (parsed._tag === "None") return
      return option(frame)(parsed.value)
    },
  }
}

async function getJson(response: Response) {
  if (!response.ok) throw new Error(`Request failed with ${response.status}`)
  return await response.json() as unknown
}

function scopeIdentity(scope: ScopeRef) {
  return `${scope.collection}\u0000${scope.scopeKey}`
}

function wireKey(key: string | readonly string[]) {
  return typeof key === "string" ? key : JSON.stringify(key)
}

function remove(values: string[], value: string) {
  const index = values.indexOf(value)
  if (index !== -1) values.splice(index, 1)
}

function reconnectDelay(attempt: number) {
  const maximum = Math.min(60_000, 1_000 * 2 ** attempt)
  return delay(maximum * (0.5 + Math.random() * 0.5))
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

class TerminalError extends Error {
  constructor(readonly status: Extract<ConnectionStatus, "upgrade-required" | "unauthorized" | "error">, message: string = status) {
    super(message)
  }
}
