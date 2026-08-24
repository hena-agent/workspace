import { preview } from "../storage/content"
import { fitsPage } from "../stream/pages"

type Kind = "permission" | "question"
export type VolatileCollection = "permissions" | "questions" | "agents" | "models" | "providers"
type Row = { id: string; sessionID: string; nonce: string } & Record<string, unknown>
type Resolution = Record<string, unknown>
type Resolved = { sessionID: string; nonce: string; value: Resolution }
type Placement = { directory: string; workspaceID?: string }
const ResolutionLimit = 1_024
const RequestNonceTTL = 10 * 60_000

export class OnlineRequestConflict extends Error {
  readonly code = "online_request_conflict"
}

export function createOnlineRequestStore(config: { nonceTTL?: number; now?: () => number } = {}) {
  const rows = new Map<string, Map<string, Record<string, unknown>>>()
  const resolutions = new Map<string, Resolved>()
  const placements = new Map<string, Placement>()
  const expirations = new Map<string, number>()
  const replies = new Map<string, Promise<unknown>>()
  const listeners = new Set<(collection: VolatileCollection, scopeKey: string) => void>()
  const catalogListeners = new Set<() => void>()
  const now = config.now ?? Date.now
  const nonceTTL = config.nonceTTL ?? RequestNonceTTL
  let revision = 0

  const changed = (collection: VolatileCollection, scopeKey: string) => {
    revision++
    listeners.forEach((listener) => {
      try {
        listener(collection, scopeKey)
      } catch (cause) {
        console.error(
          JSON.stringify({ type: "online_listener_error", name: cause instanceof Error ? cause.name : "Unknown" }),
        )
      }
    })
  }

  return {
    project(event: { type: string; data: unknown; location?: Placement }) {
      if (isRequestEvent(event.data) && event.type === "permission.v2.asked") {
        scoped("permissions", "").set(event.data.id, boundRequest(event.data, crypto.randomUUID()))
        expirations.set(`permission:${event.data.id}`, now() + nonceTTL)
        rememberPlacement("permission", event.data.id, event.location)
        changed("permissions", "")
        return
      }
      if (isRequestEvent(event.data) && event.type === "question.v2.asked") {
        scoped("questions", "").set(event.data.id, boundRequest(event.data, crypto.randomUUID()))
        expirations.set(`question:${event.data.id}`, now() + nonceTTL)
        rememberPlacement("question", event.data.id, event.location)
        changed("questions", "")
        return
      }
      if (event.type === "catalog.updated") catalogListeners.forEach((listener) => listener())
      if (!isResolutionEvent(event.data)) return
      if (event.type === "permission.v2.replied") resolve("permissions", event.data.requestID, event.data)
      if (event.type === "question.v2.replied" || event.type === "question.v2.rejected")
        resolve("questions", event.data.requestID, event.data)
    },
    pending(kind: Kind, id: string, sessionID: string, nonce: string) {
      const row = pendingRow(kind, id)
      return isPendingRow(row) && row.sessionID === sessionID && row.nonce === nonce
    },
    request(kind: Kind, id: string, sessionID: string, nonce: string) {
      const row = pendingRow(kind, id)
      const location = placements.get(`${kind}:${id}`)
      return isPendingRow(row) && row.sessionID === sessionID && row.nonce === nonce && location
        ? { location }
        : undefined
    },
    resolution(kind: Kind, id: string, sessionID?: string, nonce?: string) {
      const resolved = resolutions.get(`${kind}:${id}`)
      if (!resolved) return undefined
      if (sessionID !== undefined && (resolved.sessionID !== sessionID || resolved.nonce !== nonce)) return undefined
      return resolved.value
    },
    complete(kind: Kind, id: string, resolution: Resolution) {
      const key = `${kind}:${id}`
      const existing = resolutions.get(key)
      const row = scoped(collection(kind), "").get(id)
      const authoritative = existing?.value ?? resolution
      if (existing) rememberResolution(key, existing)
      else if (isPendingRow(row)) rememberResolution(key, { sessionID: row.sessionID, nonce: row.nonce, value: authoritative })
      placements.delete(key)
      expirations.delete(key)
      if (scoped(collection(kind), "").delete(id)) changed(collection(kind), "")
      return authoritative
    },
    interrupt(sessionID: string) {
      const targets = ["permissions", "questions"] as const
      targets.forEach((target) => {
        const scopedRows = scoped(target, "")
        const removed = Array.from(scopedRows).filter(([, row]) => row.sessionID === sessionID)
        removed.forEach(([id]) => {
          scopedRows.delete(id)
          const key = `${target === "permissions" ? "permission" : "question"}:${id}`
          placements.delete(key)
          expirations.delete(key)
        })
        if (removed.length > 0) changed(target, "")
      })
    },
    serialize<T>(kind: Kind, id: string, reply: () => Promise<T>) {
      const key = `${kind}:${id}`
      const result = (replies.get(key) ?? Promise.resolve()).then(reply, reply)
      replies.set(key, result)
      return result.finally(() => {
        if (replies.get(key) === result) replies.delete(key)
      })
    },
    replace(
      target: VolatileCollection,
      scopeKey: string,
      incoming: readonly { key: string; row: Record<string, unknown> }[],
    ) {
      rows.set(
        sourceKey(target, scopeKey),
        new Map(
          incoming.flatMap((item) => {
            const row = boundCatalogRow(target, scopeKey, item.key, item.row)
            return row ? [[item.key, row] as const] : []
          }),
        ),
      )
      changed(target, scopeKey)
    },
    remove(target: VolatileCollection, scopeKey: string) {
      if (rows.delete(sourceKey(target, scopeKey))) changed(target, scopeKey)
    },
    retainCatalogs(scopeKeys: readonly string[]) {
      const retained = new Set(scopeKeys)
      for (const collection of ["agents", "models", "providers"] as const) {
        Array.from(rows.keys())
          .filter((key) => key.startsWith(`${collection}\u0000`) && !retained.has(key.slice(collection.length + 1)))
          .forEach((key) => {
            rows.delete(key)
            changed(collection, key.slice(collection.length + 1))
          })
      }
    },
    snapshot(target: VolatileCollection, scopeKey = "") {
      const targetRows = scoped(target, scopeKey)
      if (target === "permissions" || target === "questions") {
        const kind = target === "permissions" ? "permission" : "question"
        const time = now()
        const expired = Array.from(targetRows).filter(
          (entry): entry is [string, Row] =>
            isPendingRow(entry[1]) && (expirations.get(`${kind}:${entry[0]}`) ?? 0) <= time,
        )
        expired.forEach(([id, row]) => {
          targetRows.set(id, boundRequest(row, crypto.randomUUID()))
          expirations.set(`${kind}:${id}`, time + nonceTTL)
        })
        if (expired.length > 0) changed(target, scopeKey)
      }
      return {
        revision,
        rows: Array.from(targetRows, ([key, row]) => ({ key, row, revision: String(revision) })),
      }
    },
    subscribe(listener: (collection: VolatileCollection, scopeKey: string) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    subscribeCatalog(listener: () => void) {
      catalogListeners.add(listener)
      return () => catalogListeners.delete(listener)
    },
  }

  function scoped(target: VolatileCollection, scopeKey: string) {
    const key = sourceKey(target, scopeKey)
    const existing = rows.get(key) ?? new Map<string, Record<string, unknown>>()
    rows.set(key, existing)
    return existing
  }

  function resolve(target: "permissions" | "questions", id: string, resolution: Resolution) {
    const row = scoped(target, "").get(id)
    if (!isPendingRow(row)) return
    scoped(target, "").delete(id)
    const key = `${target === "permissions" ? "permission" : "question"}:${id}`
    placements.delete(key)
    expirations.delete(key)
    rememberResolution(key, { sessionID: row.sessionID, nonce: row.nonce, value: resolution })
    changed(target, "")
  }

  function rememberResolution(key: string, resolution: Resolved) {
    resolutions.delete(key)
    resolutions.set(key, resolution)
    if (resolutions.size <= ResolutionLimit) return
    const oldest = resolutions.keys().next().value
    if (oldest) resolutions.delete(oldest)
  }

  function rememberPlacement(kind: Kind, id: string, placement?: Placement) {
    const key = `${kind}:${id}`
    if (placement) placements.set(key, placement)
    else placements.delete(key)
  }

  function pendingRow(kind: Kind, id: string) {
    const target = collection(kind)
    const row = scoped(target, "").get(id)
    if (!isPendingRow(row)) return row
    const key = `${kind}:${id}`
    if ((expirations.get(key) ?? 0) > now()) return row
    const replacement = boundRequest(row, crypto.randomUUID())
    scoped(target, "").set(id, replacement)
    expirations.set(key, now() + nonceTTL)
    changed(target, "")
    return replacement
  }
}

export type OnlineRequestStore = ReturnType<typeof createOnlineRequestStore>

function collection(kind: Kind): "permissions" | "questions" {
  return kind === "permission" ? "permissions" : "questions"
}

function sourceKey(collection: VolatileCollection, scopeKey: string) {
  return `${collection}\u0000${scopeKey}`
}

function boundRequest(data: { id: string; sessionID: string } & Record<string, unknown>, nonce: string) {
  const row = { ...data, nonce }
  if (fitsPage([{ key: data.id, row, revision: "0" }])) return row
  const withoutMetadata = {
    ...data,
    ...(data.metadata === undefined ? {} : { metadata: { truncated: true } }),
    nonce,
    truncated: true,
  }
  if (fitsPage([{ key: data.id, row: withoutMetadata, revision: "0" }])) return withoutMetadata
  return { id: data.id, sessionID: data.sessionID, nonce, truncated: true }
}

function boundCatalogRow(collection: VolatileCollection, scopeKey: string, key: string, row: Record<string, unknown>) {
  const fits = (value: Record<string, unknown>) =>
    fitsPage([{ key, row: value, revision: "0" }], (rows) => ({ scope: { collection, scopeKey }, rows }))
  if (fits(row)) return row
  const projected = Object.fromEntries(
    Object.entries(row)
      .map(([field, value]) => {
        if (typeof value === "string") return [field, preview(value).text] as const
        if (typeof value === "number" || typeof value === "boolean") return [field, value] as const
        return undefined
      })
      .filter((entry) => entry !== undefined),
  )
  const candidate = { ...projected, truncated: true }
  if (fits(candidate)) return candidate
  const minimal = { id: typeof row.id === "string" ? preview(row.id).text : key, truncated: true }
  return fits(minimal) ? minimal : undefined
}

function isRequestEvent(data: unknown): data is { id: string; sessionID: string } & Record<string, unknown> {
  return (
    typeof data === "object" &&
    data !== null &&
    "id" in data &&
    typeof data.id === "string" &&
    "sessionID" in data &&
    typeof data.sessionID === "string"
  )
}

function isPendingRow(data: unknown): data is Row {
  return isRequestEvent(data) && "nonce" in data && typeof data.nonce === "string"
}

function isResolutionEvent(data: unknown): data is { requestID: string } & Record<string, unknown> {
  return typeof data === "object" && data !== null && "requestID" in data && typeof data.requestID === "string"
}
