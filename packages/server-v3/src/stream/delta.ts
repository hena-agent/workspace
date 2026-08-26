export type PartKind = "text" | "reasoning" | "tool-input" | "compaction"

export type PartIdentity = {
  sessionId: string
  messageId: string
  partId: string
  partKind: PartKind
}

export type Delta = PartIdentity & { offset: number; text: string }

export function createDeltaHub() {
  const offsets = new Map<string, number>()
  const listeners = new Map<string, Set<(delta: Delta) => void>>()

  return {
    publish(input: PartIdentity & { text: string }) {
      const key = partKey(input)
      const delta = { ...input, offset: offsets.get(key) ?? 0 }
      offsets.set(key, delta.offset + new TextEncoder().encode(input.text).byteLength)
      listeners.get(input.sessionId)?.forEach((listener) => listener(delta))
      return delta
    },
    finalize(identity: PartIdentity) {
      offsets.delete(partKey(identity))
    },
    subscribe(sessionID: string, listener: (delta: Delta) => void) {
      const scoped = listeners.get(sessionID) ?? new Set()
      scoped.add(listener)
      listeners.set(sessionID, scoped)
      return () => {
        scoped.delete(listener)
        if (scoped.size === 0) listeners.delete(sessionID)
      }
    },
  }
}

function partKey(identity: PartIdentity) {
  return `${identity.sessionId}\u0000${identity.messageId}\u0000${identity.partKind}\u0000${identity.partId}`
}

export type DeltaHub = ReturnType<typeof createDeltaHub>
