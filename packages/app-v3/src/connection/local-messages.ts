import type { createConnectionStore } from "./store"
import { isTranscriptCurrent } from "./transcript"

type Row = Record<string, unknown>
type Store = ReturnType<typeof createConnectionStore>
type Entry = { row: Row; acknowledged: boolean }

export function createLocalMessages(store: Store) {
  const sessions = new Map<string, Map<string, Entry>>()
  const listeners = new Map<string, Set<() => void>>()
  const revisions = new Map<string, number>()

  const notify = (sessionId: string) => {
    revisions.set(sessionId, (revisions.get(sessionId) ?? 0) + 1)
    listeners.get(sessionId)?.forEach((listener) => listener())
  }
  const cleanup = (sessionId: string) => {
    if (!sessions.has(sessionId) && !listeners.has(sessionId)) revisions.delete(sessionId)
  }
  const remove = (sessionId: string, messageId: string) => {
    const messages = sessions.get(sessionId)
    if (!messages?.delete(messageId)) return false
    if (messages.size === 0) sessions.delete(sessionId)
    return true
  }
  const reconcile = (sessionId: string) => {
    const entries = sessions.get(sessionId)
    // Keep the local copy until parts catch up so message promotion cannot create a blank transcript.
    if (!entries || !isTranscriptCurrent(store, sessionId)) return false
    const messages = new Set(store.authoritativeRows("messages", sessionId).flatMap((row) =>
      typeof row.id === "string" ? [row.id] : [],
    ))
    const inputsReady = store.isReady("sessionInputs", sessionId) && !store.isSynchronizing("sessionInputs", sessionId)
    const inputs = new Set(inputsReady
      ? store.authoritativeRows("sessionInputs", sessionId).flatMap((row) => typeof row.id === "string" ? [row.id] : [])
      : [])
    const removed = Array.from(entries).flatMap(([messageId, entry]) =>
      messages.has(messageId) || (entry.acknowledged && inputsReady && !inputs.has(messageId)) ? [messageId] : [],
    )
    removed.forEach((messageId) => remove(sessionId, messageId))
    return removed.length > 0
  }
  const reconcileSession = (sessionId: string) => {
    if (!reconcile(sessionId)) return
    notify(sessionId)
    cleanup(sessionId)
  }
  const unsubscribe = store.subscribe(() => {
    sessions.forEach((_, sessionId) => reconcileSession(sessionId))
  })

  return {
    rows(sessionId: string) {
      return Array.from(sessions.get(sessionId)?.values() ?? [], (entry) => entry.row)
    },
    revision(sessionId: string) {
      return revisions.get(sessionId) ?? 0
    },
    subscribe(sessionId: string, listener: () => void) {
      const scoped = listeners.get(sessionId) ?? new Set<() => void>()
      scoped.add(listener)
      listeners.set(sessionId, scoped)
      return () => {
        scoped.delete(listener)
        if (scoped.size === 0) listeners.delete(sessionId)
        cleanup(sessionId)
      }
    },
    stage(sessionId: string, messageId: string, row: Row) {
      const messages = sessions.get(sessionId) ?? new Map()
      messages.set(messageId, { row, acknowledged: false })
      sessions.set(sessionId, messages)
      notify(sessionId)
    },
    acknowledge(sessionId: string, messageId: string) {
      const entry = sessions.get(sessionId)?.get(messageId)
      if (!entry) return
      entry.acknowledged = true
      reconcileSession(sessionId)
    },
    drop(sessionId: string, messageId: string) {
      if (!remove(sessionId, messageId)) return
      notify(sessionId)
      cleanup(sessionId)
    },
    dropSession(sessionId: string) {
      const removed = sessions.delete(sessionId)
      if (removed) notify(sessionId)
      cleanup(sessionId)
    },
    clear() {
      const changed = Array.from(sessions.keys())
      sessions.clear()
      changed.forEach((sessionId) => {
        notify(sessionId)
        cleanup(sessionId)
      })
    },
    dispose() {
      unsubscribe()
      sessions.clear()
      listeners.clear()
      revisions.clear()
    },
  }
}
