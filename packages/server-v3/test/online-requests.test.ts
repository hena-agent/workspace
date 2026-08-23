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
    const pending = online.snapshot("permissions").rows[0]!.row
    const nonce = pending.nonce as string

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

  test("invalidates location catalogs without durable changes", () => {
    const online = createOnlineRequestStore()
    let invalidations = 0
    online.subscribeCatalog(() => invalidations++)
    online.replace("providers", '{"directory":"/repo"}', [{ key: "openai", row: { id: "openai" } }])

    online.project({ type: "catalog.updated", data: {} })

    expect(invalidations).toBe(1)
    expect(online.snapshot("providers", '{"directory":"/repo"}').rows).toHaveLength(1)
  })
})
