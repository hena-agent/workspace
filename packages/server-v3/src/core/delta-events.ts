import type { DeltaHub, PartIdentity } from "../stream/delta"

type Event = { type: string; data: unknown }

export function publishDelta(hub: DeltaHub, event: Event) {
  if (!isRecord(event.data)) return
  const identity = identityFrom(event)
  if (!identity) return
  const text = event.type === "session.next.compaction.delta" ? event.data.text : event.type.endsWith(".delta") ? event.data.delta : undefined
  if (typeof text === "string") hub.publish({ ...identity, text })
  if (event.type.endsWith(".ended") || event.type === "session.next.compaction.discarded") hub.finalize(identity)
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null
}

function identityFrom(event: Event): PartIdentity | undefined {
  if (!isRecord(event.data)) return undefined
  const sessionId = event.data.sessionID
  if (typeof sessionId !== "string") return undefined
  if (event.type.startsWith("session.next.text."))
    return identity(sessionId, event.data.assistantMessageID, event.data.textID, "text")
  if (event.type.startsWith("session.next.reasoning."))
    return identity(sessionId, event.data.assistantMessageID, event.data.reasoningID, "reasoning")
  if (event.type.startsWith("session.next.tool.input."))
    return identity(sessionId, event.data.assistantMessageID, event.data.callID, "tool-input")
  if (event.type.startsWith("session.next.compaction."))
    return identity(sessionId, event.data.messageID, event.data.messageID, "compaction")
}

function identity(sessionId: string, messageId: unknown, partId: unknown, partKind: PartIdentity["partKind"]) {
  if (typeof messageId !== "string" || typeof partId !== "string") return undefined
  return { sessionId, messageId, partId, partKind }
}
