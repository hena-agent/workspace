import type { ScopeRef } from "./store"

export const TranscriptCollections = ["messages", "parts"] as const
// Input snapshots can reflect promotion before its message replay arrives.
export const TranscriptReconciliationCollections = [...TranscriptCollections, "sessionInputs"] as const
export const TranscriptStatusKey = "status"

export function isTranscriptCollection(collection: string): collection is typeof TranscriptCollections[number] {
  return collection === "messages" || collection === "parts"
}

export function isTranscriptReconciliationCollection(collection: string): collection is typeof TranscriptReconciliationCollections[number] {
  return TranscriptReconciliationCollections.some((item) => item === collection)
}

export function transcriptRowCollection(key: string) {
  return TranscriptCollections.find((collection) => key.startsWith(`${collection}\u0000`))
}

export function transcriptScopes(sessionId: string): ScopeRef[] {
  return TranscriptCollections.map((collection) => ({ collection, scopeKey: sessionId }))
}

export function transcriptReconciliationScopes(sessionId: string): ScopeRef[] {
  return TranscriptReconciliationCollections.map((collection) => ({ collection, scopeKey: sessionId }))
}

export function coupledTranscriptScopes(scopes: readonly ScopeRef[]) {
  const result = new Map(scopes.map((scope) => [`${scope.collection}\u0000${scope.scopeKey}`, scope]))
  scopes.forEach((scope) => {
    if (!isTranscriptReconciliationCollection(scope.collection)) return
    transcriptReconciliationScopes(scope.scopeKey).forEach((item) => result.set(`${item.collection}\u0000${item.scopeKey}`, item))
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
