import type { ScopeRef } from "./store"

export const TranscriptCollections = ["messages", "parts"] as const

export function isTranscriptCollection(collection: string): collection is typeof TranscriptCollections[number] {
  return collection === "messages" || collection === "parts"
}

export function transcriptScopes(sessionId: string): ScopeRef[] {
  return TranscriptCollections.map((collection) => ({ collection, scopeKey: sessionId }))
}

export function coupledTranscriptScopes(scopes: readonly ScopeRef[]) {
  const result = new Map(scopes.map((scope) => [`${scope.collection}\u0000${scope.scopeKey}`, scope]))
  scopes.forEach((scope) => {
    if (!isTranscriptCollection(scope.collection)) return
    transcriptScopes(scope.scopeKey).forEach((item) => result.set(`${item.collection}\u0000${item.scopeKey}`, item))
  })
  return Array.from(result.values())
}

function isTranscriptReady(store: { isReady(collection: string, scopeKey: string): boolean }, sessionId: string) {
  return TranscriptCollections.every((collection) => store.isReady(collection, sessionId))
}

export function isTranscriptCurrent(store: {
  isReady(collection: string, scopeKey: string): boolean
  isSynchronizing(collection: string, scopeKey: string): boolean
}, sessionId: string) {
  return isTranscriptReady(store, sessionId) && TranscriptCollections.every((collection) => !store.isSynchronizing(collection, sessionId))
}
