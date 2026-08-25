import { describe, expect, test } from "bun:test"
import { receipt, requestQueueable } from "./lifecycle"

describe("mutation lifecycle", () => {
  test("retries transient responses and preserves the caller's request identity", async () => {
    const idempotencyKey = crypto.randomUUID()
    const seen: string[] = []
    const delays: number[] = []
    const result = await requestQueueable(
      async () => {
        seen.push(idempotencyKey)
        return seen.length < 3 ? response(503, {}) : response(200, { ok: true })
      },
      { random: () => 0, sleep: async (milliseconds) => { delays.push(milliseconds) } },
    )

    expect(result).toEqual({ ok: true })
    expect(seen).toEqual([idempotencyKey, idempotencyKey, idempotencyKey])
    expect(delays).toEqual([2_000, 4_000])
  })

  test("fails non-retriable typed conflicts immediately", async () => {
    let requests = 0
    const result = requestQueueable(async () => {
      requests += 1
      return response(409, { error: { code: "revision_conflict", message: "Revision changed" } })
    }, { sleep: async () => {} })

    await expect(result).rejects.toMatchObject({ code: "revision_conflict", message: "Revision changed" })
    expect(requests).toBe(1)
  })

  test("accepts exact-retry receipts as authoritative acknowledgements", () => {
    expect(receipt({
      receipt: {
        txid: "tx-1",
        outcome: "exact_retry",
        through: { feedId: "feed-1", seq: 4 },
        affectedScopes: [{ collection: "sessions", scopeKey: "" }],
      },
    })).toMatchObject({ txid: "tx-1", outcome: "exact_retry" })
  })
})

function response(status: number, value: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => value,
  }
}
