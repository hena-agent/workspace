import type { Database } from "bun:sqlite"
import { fingerprint } from "./fingerprint"
import type { createChangeStore } from "./changes"

export class IdempotencyConflict extends Error {
  readonly code = "idempotency_conflict"
}

type IdempotencyInput = {
  principal: string
  operation: string
  key: string
  payload: unknown
}

type RecordRow = {
  fingerprint: string
  response: string
}

export function createIdempotencyStore(database: Database, changes: ReturnType<typeof createChangeStore>) {
  const get = database.query<RecordRow, [string, string, string]>(`
    SELECT fingerprint, response FROM idempotency_record
    WHERE principal = ? AND operation = ? AND key = ?
  `)
  const insert = database.query(`
    INSERT INTO idempotency_record (principal, operation, key, fingerprint, response, txid, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  return {
    run<Response>(input: IdempotencyInput, execute: () => Response) {
      const requestFingerprint = fingerprint(input.payload)
      const recorded = get.get(input.principal, input.operation, input.key)
      if (recorded?.fingerprint !== undefined && recorded.fingerprint !== requestFingerprint) throw new IdempotencyConflict()
      if (recorded) return { outcome: "exact_retry" as const, response: JSON.parse(recorded.response) as Response }

      return changes.batch(() => database.transaction(() => {
        const response = execute()
        insert.run(
          input.principal,
          input.operation,
          input.key,
          requestFingerprint,
          JSON.stringify(response),
          responseTxid(response),
          Date.now(),
        )
        return { outcome: "applied" as const, response }
      })())
    },
  }
}

function responseTxid(response: unknown) {
  if (typeof response !== "object" || response === null) return crypto.randomUUID()
  if ("txid" in response && typeof response.txid === "string") return response.txid
  if ("receipt" in response && typeof response.receipt === "object" && response.receipt !== null && "txid" in response.receipt && typeof response.receipt.txid === "string")
    return response.receipt.txid
  return crypto.randomUUID()
}
