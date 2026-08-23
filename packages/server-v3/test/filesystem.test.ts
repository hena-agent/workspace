import { afterEach, describe, expect, test } from "bun:test"
import { createApp } from "../src/app"
import type { CoreDomain } from "../src/core/domain"
import type { SyncDatabase } from "../src/storage/database"
import { createTestDatabase } from "./fixture"

describe("filesystem reads", () => {
  let database: SyncDatabase | undefined

  afterEach(() => database?.close())

  test("passes a bounded location query to the domain", async () => {
    database = createTestDatabase().database
    const domain = fileDomain()
    const response = await createApp({ database, domain }).request("/api/fs/find?directory=%2Ftmp%2Fproject&query=src&type=file&limit=20")

    expect(response.status).toBe(200)
    expect(domain.finds).toEqual([{ directory: "/tmp/project", query: "src", type: "file", limit: "20" }])
    expect(await response.json()).toEqual({ data: [{ path: "src/main.ts", type: "file" }] })
  })

  test("requires a location", async () => {
    database = createTestDatabase().database
    const response = await createApp({ database, domain: fileDomain() }).request("/api/fs/list")

    expect(response.status).toBe(400)
  })
})

function fileDomain(): CoreDomain & { finds: unknown[] } {
  const finds: unknown[] = []
  const unavailable = () => Promise.reject(new Error("unused"))
  return {
    finds,
    ready: async () => {},
    createSession: unavailable,
    admitPrompt: unavailable,
    interrupt: unavailable,
    cancelInput: unavailable,
    reorderInputs: unavailable,
    listFiles: async () => [],
    findFiles: async (input) => {
      finds.push(input)
      return [{ path: "src/main.ts", type: "file" }]
    },
    replyPermission: async () => ({ outcome: "applied", resolution: {} }),
    replyQuestion: async () => ({ outcome: "applied", resolution: {} }),
    catalog: async () => ({ agents: [], models: [], providers: [] }),
    dispose: async () => {},
  }
}
