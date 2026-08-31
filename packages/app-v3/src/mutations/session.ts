import { createTransaction } from "@tanstack/db"
import { Permission } from "@hena/schema/permission"
import { Question } from "@hena/schema/question"
import { Session } from "@hena/schema/session"
import { SessionMessage } from "@hena/schema/session-message"
import type { createConnectionAgent } from "@/connection/agent"
import { MutationError, mutationError, receipt, requestQueueable } from "./lifecycle"

type Agent = ReturnType<typeof createConnectionAgent>
type Scope = { readonly collection: string; readonly scopeKey: string }
export type PromptFile = { uri: string; name?: string; description?: string }
export type OnlineReplyResult = { outcome: "applied" | "already_resolved"; resolution: Record<string, unknown>; divergent: boolean }

const pendingMessages = new Set<string>()
const stoppingSessions = new Set<string>()
const mutationListeners = new Set<() => void>()
let mutationVersion = 0

export function subscribeMutationState(listener: () => void) {
  mutationListeners.add(listener)
  return () => mutationListeners.delete(listener)
}

export function getMutationStateVersion() {
  return mutationVersion
}

export function isMessagePending(messageID: string) {
  return pendingMessages.has(messageID)
}

export function isSessionStopping(agent: Agent | undefined, sessionID: string) {
  return agent ? stoppingSessions.has(stateKey(agent, sessionID)) : false
}

export function createSessionOptimistically(agent: Agent, input: {
  projectID: string
  location: { directory: string; workspaceID?: string }
  text: string
  files?: PromptFile[]
  delivery: "steer" | "queue"
  agentID?: string
  model?: { id: string; providerID: string }
}) {
  const sessionID = Session.ID.create()
  const messageID = SessionMessage.ID.create()
  const created = Date.now()
  const idempotencyKey = crypto.randomUUID()
  const prompt = promptPayload(input.text, input.files)
  const resolvedProjectID = Promise.withResolvers<string>()
  markPending(messageID, true)
  const transaction = createTransaction({
    mutationFn: async () => {
      const result = await requestQueueable(() => agent.client.api.session.$post({
          json: {
            idempotencyKey,
            sessionID,
            messageID,
            location: input.location,
            prompt,
            delivery: input.delivery,
            agent: input.agentID,
            model: input.model,
          },
        }))
      await awaitReceipt(agent, result)
      resolvedProjectID.resolve(projectID(result) ?? input.projectID)
    },
  })
  transaction.mutate(() => {
    agent.store.collection("sessions", "").insert({
      __key: sessionID,
      row: {
        id: sessionID,
        projectID: input.projectID,
        title: input.text.slice(0, 80) || "Untitled session",
        location: input.location,
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created, updated: created },
        working: true,
        agent: input.agentID,
        model: input.model,
      },
    })
    agent.store.collection("messages", sessionID).insert({
      __key: messageID,
      row: { id: messageID, sessionID, type: "user", text: input.text, files: input.files, time: { created } },
    })
  })
  void transaction.isPersisted.promise.finally(() => markPending(messageID, false)).catch(() => {})
  return { sessionID, messageID, transaction, projectID: resolvedProjectID.promise }
}

export function admitPromptOptimistically(agent: Agent, input: {
  sessionID: string
  text: string
  files?: PromptFile[]
  delivery: "steer" | "queue"
  agentID?: string
  model?: { id: string; providerID: string }
}) {
  const messageID = SessionMessage.ID.create()
  const created = Date.now()
  const idempotencyKey = crypto.randomUUID()
  const prompt = promptPayload(input.text, input.files)
  if (input.delivery === "steer") markPending(messageID, true)
  const transaction = createTransaction({
    mutationFn: async () => {
      const result = await requestQueueable(() => agent.client.api.session[":sessionId"].prompt.$post({
          param: { sessionId: input.sessionID },
          json: { idempotencyKey, messageID, prompt, delivery: input.delivery, agent: input.agentID, model: input.model },
        }))
      await awaitReceipt(agent, result)
    },
  })
  transaction.mutate(() => {
    agent.store.collection("sessions", "").update(input.sessionID, (draft) => {
      draft.row = {
        ...draft.row,
        ...(input.agentID ? { agent: input.agentID } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.delivery === "queue" ? { queueRevision: number(draft.row.queueRevision) + 1 } : {}),
        time: { ...object(draft.row.time), updated: created },
      }
    })
    if (input.delivery === "steer") {
      agent.store.collection("messages", input.sessionID).insert({
        __key: messageID,
        row: { id: messageID, sessionID: input.sessionID, type: "user", text: input.text, files: input.files, time: { created } },
      })
      agent.store.collection("sessions", "").update(input.sessionID, (draft) => {
        draft.row = { ...draft.row, working: true }
      })
      return
    }
    agent.store.collection("sessionInputs", input.sessionID).insert({
      __key: messageID,
      row: {
        id: messageID,
        sessionID: input.sessionID,
        prompt,
        delivery: "queue",
        admittedSeq: Number.MAX_SAFE_INTEGER,
        queuePosition: agent.store.rows("sessionInputs", input.sessionID).length,
        timeCreated: created,
      },
    })
  })
  void transaction.isPersisted.promise.finally(() => markPending(messageID, false)).catch(() => {})
  return { messageID, transaction }
}

export function interruptOptimistically(agent: Agent, sessionID: string) {
  setStopping(agent, sessionID, true)
  return agent.client.api.session[":sessionId"].interrupt.$post({ param: { sessionId: sessionID } })
    .then(async (response) => {
      if (!response.ok) throw mutationError(await response.json(), response.status)
      await waitForSyncedState(agent, "sessions", "", (row) => row.id === sessionID && row.working === false)
    })
    .finally(() => setStopping(agent, sessionID, false))
}

export function archiveSessionOptimistically(agent: Agent, sessionID: string) {
  const idempotencyKey = crypto.randomUUID()
  const transaction = createTransaction({
    mutationFn: async () => {
      const result = await requestQueueable(() => agent.client.api.session[":sessionId"].archive.$post({
        param: { sessionId: sessionID },
        json: { idempotencyKey },
      }))
      await awaitReceipt(agent, result)
    },
  })
  transaction.mutate(() => {
    agent.store.collection("sessions", "").update(sessionID, (draft) => {
      draft.row = { ...draft.row, time: { ...object(draft.row.time), archived: Date.now() } }
    })
  })
  return transaction.isPersisted.promise
}

export function cancelInputOptimistically(agent: Agent, input: { sessionID: string; messageID: string; expectedRevision: number }) {
  const idempotencyKey = crypto.randomUUID()
  const transaction = createTransaction({
    mutationFn: async () => {
      const result = await requestQueueable(() => agent.client.api.session[":sessionId"].input[":inputId"].cancel.$post({
          param: { sessionId: input.sessionID, inputId: input.messageID },
          json: { idempotencyKey, expectedRevision: input.expectedRevision },
        }))
      await awaitReceipt(agent, result)
    },
  })
  transaction.mutate(() => {
    agent.store.collection("sessionInputs", input.sessionID).delete(input.messageID)
    incrementQueueRevision(agent, input.sessionID)
  })
  return transaction.isPersisted.promise
}

export function reorderInputsOptimistically(agent: Agent, input: { sessionID: string; messageIDs: string[]; expectedRevision: number }) {
  const idempotencyKey = crypto.randomUUID()
  const transaction = createTransaction({
    mutationFn: async () => {
      const result = await requestQueueable(() => agent.client.api.session[":sessionId"]["input-order"].$put({
          param: { sessionId: input.sessionID },
          json: { idempotencyKey, expectedRevision: input.expectedRevision, messageIDs: input.messageIDs },
        }))
      await awaitReceipt(agent, result)
    },
  })
  transaction.mutate(() => {
    input.messageIDs.forEach((messageID, queuePosition) => {
      agent.store.collection("sessionInputs", input.sessionID).update(messageID, (draft) => {
        draft.row = { ...draft.row, queuePosition }
      })
    })
    incrementQueueRevision(agent, input.sessionID)
  })
  return transaction.isPersisted.promise
}

export function replyPermissionOptimistically(agent: Agent, input: {
  id: string
  sessionID: string
  nonce: string
  location: { directory: string; workspaceID?: string }
  reply: "once" | "always" | "reject"
}) {
  return replyOnline(
    agent,
    "permissions",
    input.id,
    () => agent.client.api.permission[":id"].reply.$post({
      param: { id: Permission.ID.make(input.id) },
      json: { location: input.location, sessionID: Session.ID.make(input.sessionID), nonce: input.nonce, reply: input.reply },
    }),
    (resolution) => resolution.reply !== input.reply,
  )
}

export function replyQuestionOptimistically(agent: Agent, input: {
  id: string
  sessionID: string
  nonce: string
  location: { directory: string; workspaceID?: string }
  answers: string[][]
}) {
  return replyOnline(
    agent,
    "questions",
    input.id,
    () => agent.client.api.question[":id"].reply.$post({
      param: { id: Question.ID.make(input.id) },
      json: { location: input.location, sessionID: Session.ID.make(input.sessionID), nonce: input.nonce, answers: input.answers },
    }),
    (resolution) => JSON.stringify(resolution.answers) !== JSON.stringify(input.answers),
  )
}

export function promptPayload(text: string, files: PromptFile[] = []) {
  const sizes = files.map((file) => inlinedBytes(file.uri))
  if (sizes.some((size) => size > 5 * 1024 * 1024))
    throw new MutationError("Each attachment must be 5 MiB or smaller.", "payload_too_large")
  if (sizes.reduce((total, size) => total + size, 0) > 20 * 1024 * 1024)
    throw new MutationError("Attachments must total 20 MiB or less.", "payload_too_large")
  return { text, ...(files.length > 0 ? { files } : {}) }
}

function replyOnline(
  agent: Agent,
  collection: "permissions" | "questions",
  id: string,
  request: () => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>,
  divergent: (resolution: Record<string, unknown>) => boolean,
) {
  let result: OnlineReplyResult | undefined
  const transaction = createTransaction({
    mutationFn: async () => {
      const response = await request()
      const value = await response.json()
      if (!response.ok) throw mutationError(value, response.status)
      if (!isRecord(value) || (value.outcome !== "applied" && value.outcome !== "already_resolved") || !isRecord(value.resolution))
        throw new MutationError("The server returned an invalid reply result.", "internal")
      result = { outcome: value.outcome, resolution: value.resolution, divergent: value.outcome === "already_resolved" && divergent(value.resolution) }
      await waitForAuthoritativeState(agent, collection, "", (row) => row.id !== id)
    },
  })
  transaction.mutate(() => agent.store.collection(collection, "").delete(id))
  return transaction.isPersisted.promise.then(() => result!)
}

async function awaitReceipt(agent: Agent, value: unknown) {
  const acknowledged = receipt(value)
  const awaitTxid = agent.store.awaitTxid as unknown as (txid: string, timeoutMs: number, affectedScopes: readonly Scope[], throughSeq: number) => Promise<void>
  await awaitTxid(acknowledged.txid, 10_000, acknowledged.affectedScopes, acknowledged.through.seq)
}

function waitForAuthoritativeState(
  agent: Agent,
  collection: string,
  scopeKey: string,
  predicate: (row: Record<string, unknown>) => boolean,
) {
  return agent.store.awaitAuthoritativeState({
    collection,
    scopeKey,
    timeoutMs: 5_000,
    predicate: (rows) => rows.every(predicate),
  })
}

function waitForSyncedState(
  agent: Agent,
  collection: string,
  scopeKey: string,
  predicate: (row: Record<string, unknown>) => boolean,
) {
  if (agent.store.rows(collection, scopeKey).some(predicate)) return Promise.resolve()
  return waitForNotification(agent, collection, scopeKey, (rows) => rows.some(predicate), 5_000)
}

function waitForNotification(
  agent: Agent,
  collection: string,
  scopeKey: string,
  predicate: (rows: Record<string, unknown>[]) => boolean,
  timeoutMs: number,
) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe()
      reject(new MutationError("The server replied, but synchronized state did not update within 5 seconds.", "network"))
    }, timeoutMs)
    const unsubscribe = agent.store.subscribe(() => {
      if (!predicate(agent.store.rows(collection, scopeKey))) return
      clearTimeout(timeout)
      unsubscribe()
      resolve()
    })
  })
}

function setStopping(agent: Agent, sessionID: string, value: boolean) {
  const anticipated = agent as Agent & { setSessionStopping?: (sessionID: string, stopping: boolean, timeoutMs: number) => void }
  anticipated.setSessionStopping?.(sessionID, value, 5_000)
  const key = stateKey(agent, sessionID)
  if (value) stoppingSessions.add(key)
  else stoppingSessions.delete(key)
  mutationVersion += 1
  mutationListeners.forEach((listener) => listener())
}

function markPending(messageID: string, value: boolean) {
  if (value) pendingMessages.add(messageID)
  else pendingMessages.delete(messageID)
  mutationVersion += 1
  mutationListeners.forEach((listener) => listener())
}

function stateKey(agent: Agent, sessionID: string) {
  return `${agent.url}\u0000${sessionID}`
}

function inlinedBytes(uri: string) {
  if (!/^data:/i.test(uri)) return 0
  const separator = uri.indexOf(",")
  if (separator === -1) return Number.POSITIVE_INFINITY
  const data = uri.slice(separator + 1)
  if (!uri.slice(0, separator).endsWith(";base64")) return new TextEncoder().encode(data).byteLength
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0
  return Math.floor(data.length * 3 / 4) - padding
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function projectID(result: unknown) {
  const session = isRecord(result) ? result.session : undefined
  return isRecord(session) && typeof session.projectID === "string" ? session.projectID : undefined
}

function object(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function incrementQueueRevision(agent: Agent, sessionID: string) {
  agent.store.collection("sessions", "").update(sessionID, (draft) => {
    draft.row = { ...draft.row, queueRevision: number(draft.row.queueRevision) + 1 }
  })
}
