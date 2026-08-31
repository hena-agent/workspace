import { Sync } from "@hena/schema/sync"
import { Schema } from "effect"
import type { ConnectionAgent } from "@/connection/agent"

export type MutationErrorCode =
  | "conflict"
  | "idempotency_conflict"
  | "internal"
  | "network"
  | "not_found"
  | "online_request_conflict"
  | "payload_too_large"
  | "queue_conflict"
  | "revision_conflict"
  | "unauthorized"
  | "upgrade_required"
  | "validation"

export class MutationError extends Error {
  constructor(
    message: string,
    readonly code: MutationErrorCode,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = "MutationError"
  }
}

type ResponseLike = {
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
}

type RetryOptions = {
  sleep?: (milliseconds: number) => Promise<void>
  random?: () => number
}

export async function requestQueueable(request: () => Promise<ResponseLike>, options: RetryOptions = {}) {
  const sleep = options.sleep ?? delay
  const random = options.random ?? Math.random

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await request()
      if (isTransientStatus(response.status) && attempt < 2) {
        await sleep(2_000 * 2 ** attempt + Math.floor(random() * 1_000))
        continue
      }
      const value = await response.json()
      if (!response.ok) throw mutationError(value, response.status)
      return value
    } catch (cause) {
      if (cause instanceof MutationError) throw cause
      if (attempt === 2) throw new MutationError("The server could not be reached after three attempts.", "network")
      await sleep(2_000 * 2 ** attempt + Math.floor(random() * 1_000))
    }
  }

  throw new MutationError("Mutation failed.", "internal")
}

export function receipt(value: unknown) {
  if (!isRecord(value))
    throw new MutationError("The server returned an invalid mutation receipt.", "internal")
  const decoded = Schema.decodeUnknownOption(Sync.TransactionReceipt)(value.receipt)
  if (decoded._tag === "None") throw new MutationError("The server returned an invalid mutation receipt.", "internal")
  return decoded.value
}

export async function awaitReceipt(agent: ConnectionAgent, value: unknown) {
  const acknowledged = receipt(value)
  await agent.store.awaitTxid(acknowledged.txid, 10_000, acknowledged.affectedScopes)
}

export function mutationError(value: unknown, status = 0) {
  const decoded = Schema.decodeUnknownOption(Sync.ErrorResponse)(value)
  if (decoded._tag === "None")
    return new MutationError(status >= 500 ? "The server could not complete the mutation." : "Mutation failed.", status >= 500 ? "internal" : "validation")
  const code = isMutationErrorCode(decoded.value.error.code) ? decoded.value.error.code : status >= 500 ? "internal" : "validation"
  return new MutationError(
    decoded.value.error.message,
    code,
    isRecord(decoded.value.error.details) ? decoded.value.error.details : undefined,
  )
}

function isTransientStatus(status: number) {
  return status === 429 || status >= 500
}

function isMutationErrorCode(value: unknown): value is MutationErrorCode {
  return [
    "conflict",
    "idempotency_conflict",
    "internal",
    "network",
    "not_found",
    "online_request_conflict",
    "payload_too_large",
    "queue_conflict",
    "revision_conflict",
    "unauthorized",
    "upgrade_required",
    "validation",
  ].includes(String(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}
