import type { HenaClient, QuestionAnswer, QuestionRequest, Session } from "@hena/sdk/v2/client"

// Older chat sessions have no hint. Preserve their canonical history until they are migrated.
export function usesCanonicalSession(session: Pick<Session, "metadata"> | undefined, chat: boolean) {
  return session?.metadata?.appRuntime === "canonical" || (chat && session?.metadata?.appRuntime !== "legacy")
}

export function preserveSessionRuntime(current: Session | undefined, incoming: Session): Session {
  const runtime = current?.metadata?.appRuntime
  if (runtime !== "canonical" && (incoming.metadata?.appRuntime || !runtime)) return incoming
  return { ...incoming, metadata: { ...incoming.metadata, appRuntime: runtime } }
}

export async function interruptSession(client: HenaClient, sessionID: string, session?: Pick<Session, "metadata">) {
  const current = session?.metadata?.appRuntime ? session : (await client.session.get({ sessionID })).data
  if (usesCanonicalSession(current, false)) return client.v2.session.interrupt({ sessionID })
  return client.session.abort({ sessionID })
}

export type RuntimeQuestion = QuestionRequest & { appRuntime?: "legacy" | "canonical" }

export async function pendingQuestions(client: HenaClient, directory: string) {
  const [legacy, canonical] = await Promise.all([
    client.question.list(),
    client.v2.question.request.list({ location: { directory } }),
  ])
  return {
    data: [
      ...(legacy.data ?? []).map((request): RuntimeQuestion => ({ ...request, appRuntime: "legacy" })),
      ...(canonical.data?.data ?? []).map((request): RuntimeQuestion => ({ ...request, appRuntime: "canonical" })),
    ],
  }
}

export async function respondToQuestion(client: HenaClient, request: RuntimeQuestion, answers?: QuestionAnswer[]) {
  const runtime =
    request.appRuntime ?? (await client.session.get({ sessionID: request.sessionID })).data?.metadata?.appRuntime
  if (runtime === "canonical") {
    const params = { sessionID: request.sessionID, requestID: request.id }
    if (answers) return client.v2.session.question.reply({ ...params, questionV2Reply: { answers } })
    return client.v2.session.question.reject(params)
  }
  if (answers) return client.question.reply({ requestID: request.id, answers })
  return client.question.reject({ requestID: request.id })
}
