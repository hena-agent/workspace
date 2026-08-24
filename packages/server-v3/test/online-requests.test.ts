import { describe, expect, test } from "bun:test"
import { createOnlineRequestStore } from "../src/core/online-requests"

describe("online requests", () => {
  test("publishes pending requests with a nonce and records their resolution", () => {
    const online = createOnlineRequestStore()
    const changes: string[] = []
    online.subscribe((collection) => changes.push(collection))

    online.project({
      type: "permission.v2.asked",
      data: { id: "per_1", sessionID: "ses_1", action: "read", resources: ["file"] },
    })
    const pending = online.snapshot("permissions").rows[0].row
    const nonce = requireNonce(pending)

    expect(online.pending("permission", "per_1", "ses_1", nonce)).toBe(true)
    expect(online.pending("permission", "per_1", "ses_2", nonce)).toBe(false)
    online.project({
      type: "permission.v2.replied",
      data: { requestID: "per_1", sessionID: "ses_1", reply: "once" },
    })
    expect(online.snapshot("permissions").rows).toEqual([])
    expect(online.resolution("permission", "per_1")).toEqual({ requestID: "per_1", sessionID: "ses_1", reply: "once" })
    expect(changes).toEqual(["permissions", "permissions"])
  })

  test("keeps questions separate from permissions", () => {
    const online = createOnlineRequestStore()
    online.project({ type: "question.v2.asked", data: { id: "que_1", sessionID: "ses_1", questions: [] } })

    expect(online.snapshot("permissions").rows).toEqual([])
    expect(online.snapshot("questions").rows).toHaveLength(1)
  })

  test("retains the original location for authenticated replies", () => {
    const online = createOnlineRequestStore()
    online.project({
      type: "permission.v2.asked",
      location: { directory: "/original" },
      data: { id: "per_1", sessionID: "ses_1" },
    })
    const nonce = requireNonce(online.snapshot("permissions").rows[0].row)

    expect(online.request("permission", "per_1", "ses_1", nonce)).toEqual({
      location: { directory: "/original" },
    })
  })

  test("removes requests when their session is interrupted", () => {
    const online = createOnlineRequestStore()
    online.project({ type: "permission.v2.asked", data: { id: "per_1", sessionID: "ses_1" } })
    online.project({ type: "question.v2.asked", data: { id: "que_1", sessionID: "ses_1" } })

    online.interrupt("ses_1")

    expect(online.snapshot("permissions").rows).toEqual([])
    expect(online.snapshot("questions").rows).toEqual([])
    expect(online.resolution("permission", "per_1")).toBeUndefined()
  })

  test("invalidates location catalogs without durable changes", () => {
    const online = createOnlineRequestStore()
    let invalidations = 0
    online.subscribeCatalog(() => invalidations++)
    online.replace("providers", '{"directory":"/repo"}', [{ key: "openai", row: { id: "openai" } }])

    online.project({ type: "catalog.updated", data: {} })

    expect(invalidations).toBe(1)
    expect(online.snapshot("providers", '{"directory":"/repo"}').rows).toHaveLength(1)
  })

  test("serializes replies for the same request", async () => {
    const online = createOnlineRequestStore()
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const calls: string[] = []
    const first = online.serialize("permission", "per_1", async () => {
      calls.push("first")
      started.resolve()
      await release.promise
      return "first"
    })
    await started.promise
    const second = online.serialize("permission", "per_1", async () => {
      calls.push("second")
      return "second"
    })
    await Promise.resolve()

    expect(calls).toEqual(["first"])
    release.resolve()
    expect(await Promise.all([first, second])).toEqual(["first", "second"])
    expect(calls).toEqual(["first", "second"])
  })

  test("rotates expired request nonces without dropping the pending request", () => {
    let now = 1_000
    const online = createOnlineRequestStore({ nonceTTL: 100, now: () => now })
    online.project({
      type: "permission.v2.asked",
      location: { directory: "/repo" },
      data: { id: "per_1", sessionID: "ses_1" },
    })
    const original = requireNonce(online.snapshot("permissions").rows[0].row)

    now += 101

    expect(online.request("permission", "per_1", "ses_1", original)).toBeUndefined()
    const replacement = requireNonce(online.snapshot("permissions").rows[0].row)
    expect(replacement).not.toBe(original)
    expect(online.request("permission", "per_1", "ses_1", replacement)).toEqual({
      location: { directory: "/repo" },
    })
  })

  test("bounds retained request resolutions", () => {
    const online = createOnlineRequestStore()

    Array.from({ length: 1_025 }, (_, index) => index).forEach((index) => {
      online.project({
        type: "permission.v2.asked",
        data: { id: `per_${index}`, sessionID: "ses_1" },
      })
      online.project({
        type: "permission.v2.replied",
        data: { requestID: `per_${index}`, sessionID: "ses_1", reply: "once" },
      })
    })

    expect(online.resolution("permission", "per_0")).toBeUndefined()
    expect(online.resolution("permission", "per_1024")).toMatchObject({ requestID: "per_1024" })
  })

  test("bounds volatile requests and isolates listener failures", () => {
    const online = createOnlineRequestStore()
    let notified = false
    online.subscribe(() => {
      throw new Error("listener failed")
    })
    online.subscribe(() => {
      notified = true
    })

    expect(() =>
      online.project({
        type: "permission.v2.asked",
        data: {
          id: "per_large",
          sessionID: "ses_1",
          action: "read",
          resources: ["file"],
          metadata: { output: "x".repeat(2 * 1024 * 1024) },
        },
      }),
    ).not.toThrow()

    expect(notified).toBe(true)
    expect(JSON.stringify(online.snapshot("permissions")).length).toBeLessThan(1024 * 1024)
    expect(online.snapshot("permissions").rows[0]?.row).toMatchObject({
      id: "per_large",
      action: "read",
      truncated: true,
      metadata: { truncated: true },
    })
  })

  test("bounds catalog rows before publishing snapshots", () => {
    const online = createOnlineRequestStore()

    online.replace("agents", '{"directory":"/repo"}', [
      {
        key: "build",
        row: { id: "build", name: "Build", description: "x".repeat(2 * 1024 * 1024), permissions: [] },
      },
    ])

    const snapshot = online.snapshot("agents", '{"directory":"/repo"}')
    expect(JSON.stringify(snapshot).length).toBeLessThan(1024 * 1024)
    expect(snapshot.rows[0]?.row).toMatchObject({ id: "build", name: "Build", truncated: true })
  })
})

function requireNonce(row: Record<string, unknown>) {
  if (typeof row.nonce !== "string") throw new Error("Pending request is missing its nonce")
  return row.nonce
}
