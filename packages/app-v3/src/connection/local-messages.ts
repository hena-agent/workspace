import type { createConnectionStore } from "./store"

type Row = Record<string, unknown>
type Store = ReturnType<typeof createConnectionStore>
type Entry = { row: Row; acknowledged: boolean }

export function createLocalMessages() {
  const sessions = new Map<string, Map<string, Entry>>()
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
    const entries = sessions.get(sessionId)
    if (!entries || !store.isReady("messages", sessionId) || !store.isReady("parts", sessionId)) return false
    const messages = new Set(store.authoritativeRows("messages", sessionId).flatMap((row) =>
      typeof row.id === "string" ? [row.id] : [],
    ))
    const inputsReady = store.isReady("sessionInputs", sessionId)
    const inputs = new Set(inputsReady
      ? store.authoritativeRows("sessionInputs", sessionId).flatMap((row) => typeof row.id === "string" ? [row.id] : [])
      : [])
    const removed = Array.from(entries).flatMap(([messageId, entry]) =>
      messages.has(messageId) || (entry.acknowledged && inputsReady && !inputs.has(messageId)) ? [messageId] : [],
    )
    removed.forEach((messageId) => remove(sessionId, messageId))
    return removed.length > 0
  }

  return {
    rows(sessionId: string) {
      return Array.from(sessions.get(sessionId)?.values() ?? [], (entry) => entry.row)
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
      messages.set(messageId, { row, acknowledged: false })
      sessions.set(sessionId, messages)
      notify(sessionId)
    },
    acknowledge(store: Store, sessionId: string, messageId: string) {
      const entry = sessions.get(sessionId)?.get(messageId)
      if (!entry) return
      entry.acknowledged = true
      if (reconcile(store, sessionId)) notify(sessionId)
    },
    drop(sessionId: string, messageId: string) {
      if (remove(sessionId, messageId)) notify(sessionId)
    },
    reconcile(store: Store, sessionId: string) {
      if (reconcile(store, sessionId)) notify(sessionId)
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
