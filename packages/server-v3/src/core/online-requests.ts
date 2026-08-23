type Kind = "permission" | "question"
export type VolatileCollection = "permissions" | "questions" | "agents" | "models" | "providers"
type Row = { id: string; sessionID: string; nonce: string } & Record<string, unknown>
type Resolution = Record<string, unknown>

export function createOnlineRequestStore() {
  const rows = new Map<string, Map<string, Record<string, unknown>>>()
  const resolutions = new Map<string, Resolution>()
  const replies = new Map<string, Promise<unknown>>()
  const listeners = new Set<(collection: VolatileCollection, scopeKey: string) => void>()
  const catalogListeners = new Set<() => void>()
  let revision = 0

  const changed = (collection: VolatileCollection, scopeKey: string) => {
    revision++
    listeners.forEach((listener) => listener(collection, scopeKey))
  }

  return {
    project(event: { type: string; data: unknown }) {
      if (isRequestEvent(event.data) && event.type === "permission.v2.asked") {
        scoped("permissions", "").set(event.data.id, { ...event.data, nonce: crypto.randomUUID() })
        changed("permissions", "")
        return
      }
      if (isRequestEvent(event.data) && event.type === "question.v2.asked") {
        scoped("questions", "").set(event.data.id, { ...event.data, nonce: crypto.randomUUID() })
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
      const row = scoped(collection(kind), "").get(id) as Row | undefined
      return row?.sessionID === sessionID && row.nonce === nonce
    },
    resolution(kind: Kind, id: string) {
      return resolutions.get(`${kind}:${id}`)
    },
    complete(kind: Kind, id: string, resolution: Resolution) {
      const key = `${kind}:${id}`
      const authoritative = resolutions.get(key) ?? resolution
      resolutions.set(key, authoritative)
      if (scoped(collection(kind), "").delete(id)) changed(collection(kind), "")
      return authoritative
    },
    authoritative(kind: Kind, id: string) {
      return resolutions.get(`${kind}:${id}`) ?? scoped(collection(kind), "").get(id) ?? { status: "missing" }
    },
    interrupt(sessionID: string) {
      const targets = ["permissions", "questions"] as const
      targets.forEach((target) => {
        const scopedRows = scoped(target, "")
        const removed = Array.from(scopedRows).filter(([, row]) => row.sessionID === sessionID)
        removed.forEach(([id]) => scopedRows.delete(id))
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
      rows.set(sourceKey(target, scopeKey), new Map(incoming.map((row) => [row.key, row.row])))
      changed(target, scopeKey)
    },
    snapshot(target: VolatileCollection, scopeKey = "") {
      return {
        revision,
        rows: Array.from(scoped(target, scopeKey), ([key, row]) => ({ key, row, revision: String(revision) })),
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
    if (!scoped(target, "").delete(id)) return
    resolutions.set(`${target === "permissions" ? "permission" : "question"}:${id}`, resolution)
    changed(target, "")
  }
}

export type OnlineRequestStore = ReturnType<typeof createOnlineRequestStore>

function collection(kind: Kind): "permissions" | "questions" {
  return kind === "permission" ? "permissions" : "questions"
}

function sourceKey(collection: VolatileCollection, scopeKey: string) {
  return `${collection}\u0000${scopeKey}`
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

function isResolutionEvent(data: unknown): data is { requestID: string } & Record<string, unknown> {
  return typeof data === "object" && data !== null && "requestID" in data && typeof data.requestID === "string"
}
