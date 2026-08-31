import type { Change, createConnectionStore } from "./store"

type Row = Record<string, unknown>
type Store = ReturnType<typeof createConnectionStore>

export function createLocalMessages() {
  const sessions = new Map<string, Map<string, Row>>()
  const listeners = new Map<string, Set<() => void>>()
  const revisions = new Map<string, number>()

  const notify = (sessionId: string) => {
    revisions.set(sessionId, (revisions.get(sessionId) ?? 0) + 1)
    listeners.get(sessionId)?.forEach((listener) => listener())
  }
  const remove = (sessionId: string, messageId: string) => {
    const messages = sessions.get(sessionId)
    if (!messages?.delete(messageId)) return false
    if (messages.size === 0) sessions.delete(sessionId)
    return true
  }
  const reconcile = (store: Store, sessionId: string) => {
    if (!store.isReady("messages", sessionId) || !store.isReady("parts", sessionId)) return false
    const authoritative = new Set(store.authoritativeRows("messages", sessionId).flatMap((row) =>
      typeof row.id === "string" ? [row.id] : [],
    ))
    const removed = Array.from(sessions.get(sessionId)?.keys() ?? []).filter((messageId) => authoritative.has(messageId))
    removed.forEach((messageId) => remove(sessionId, messageId))
    return removed.length > 0
  }

  return {
    rows(sessionId: string) {
      return Array.from(sessions.get(sessionId)?.values() ?? [])
    },
    revision(sessionId: string) {
      return revisions.get(sessionId) ?? 0
    },
    subscribe(sessionId: string, listener: () => void) {
      const scoped = listeners.get(sessionId) ?? new Set()
      scoped.add(listener)
      listeners.set(sessionId, scoped)
      return () => {
        scoped.delete(listener)
        if (scoped.size === 0) listeners.delete(sessionId)
      }
    },
    stage(sessionId: string, messageId: string, row: Row) {
      const messages = sessions.get(sessionId) ?? new Map()
      messages.set(messageId, row)
      sessions.set(sessionId, messages)
      notify(sessionId)
    },
    drop(sessionId: string, messageId: string) {
      if (remove(sessionId, messageId)) notify(sessionId)
    },
    applySnapshot(store: Store, collection: string, sessionId: string, rows: ReadonlyArray<{ key: string | readonly string[]; row: Row; revision?: string }>, throughSeq: number, replace = true) {
      store.applySnapshot(collection, sessionId, rows, throughSeq, replace)
      if ((collection === "messages" || collection === "parts") && reconcile(store, sessionId)) notify(sessionId)
    },
    applyRows(store: Store, frame: { throughSeq: number; changes: readonly Change[] }, transactionChanges = frame.changes) {
      const applicable = frame.changes.filter((change) => change.seq > store.cursor(change.collection, change.scopeKey))
      const promoted = new Set(transactionChanges.flatMap((change) =>
        change.collection === "messages" && change.op !== "delete" && change.txid
          ? [`${change.txid}\u0000${change.scopeKey}\u0000${wireKey(change.rowKey)}`]
          : [],
      ))
      const changed = new Set(applicable.flatMap((change) => {
        if (change.collection !== "sessionInputs" || change.op !== "delete") return []
        if (promoted.has(`${change.txid}\u0000${change.scopeKey}\u0000${wireKey(change.rowKey)}`)) return []
        return remove(change.scopeKey, wireKey(change.rowKey)) ? [change.scopeKey] : []
      }))
      store.applyRows(frame)
      applicable.forEach((change) => {
        if ((change.collection === "messages" || change.collection === "parts") && reconcile(store, change.scopeKey)) {
          changed.add(change.scopeKey)
        }
      })
      changed.forEach(notify)
    },
    dropSession(sessionId: string) {
      if (!sessions.delete(sessionId)) return
      notify(sessionId)
    },
    clear() {
      const changed = Array.from(sessions.keys())
      sessions.clear()
      changed.forEach(notify)
    },
    dispose() {
      sessions.clear()
      listeners.clear()
      revisions.clear()
    },
  }
}

function wireKey(key: string | readonly string[]) {
  return typeof key === "string" ? key : JSON.stringify(key)
}
