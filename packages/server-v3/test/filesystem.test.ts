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
    const response = await createApp({ database, domain }).request(
      "/api/fs/find?directory=%2Ftmp%2Fproject&query=src&type=file&limit=20",
    )

    expect(response.status).toBe(200)
    expect(domain.finds).toEqual([{ directory: "/tmp/project", query: "src", type: "file", limit: 20 }])
    expect(await response.json()).toEqual({ data: [{ path: "src/main.ts", type: "file" }] })
  })

  test("bounds directory listings", async () => {
    database = createTestDatabase().database
    const domain = fileDomain()
    const response = await createApp({ database, domain }).request("/api/fs/list?directory=%2Ftmp%2Fproject&limit=20")

    expect(response.status).toBe(200)
    expect(domain.lists).toEqual([{ directory: "/tmp/project", limit: 20 }])
    expect(
      (await createApp({ database, domain }).request("/api/fs/list?directory=%2Ftmp%2Fproject&limit=1001")).status,
    ).toBe(400)
  })

  test("requires a location", async () => {
    database = createTestDatabase().database
    const response = await createApp({ database, domain: fileDomain() }).request("/api/fs/list")

    expect(response.status).toBe(400)
  })

  test("rejects invalid paths and limits before calling the domain", async () => {
    database = createTestDatabase().database
    const domain = fileDomain()
    const responses = await Promise.all([
      createApp({ database, domain }).request("/api/fs/list?directory=%2Ftmp%2Fproject&path=..%2Fsecret"),
      createApp({ database, domain }).request("/api/fs/find?directory=%2Ftmp%2Fproject&query=src&limit=0"),
      createApp({ database, domain }).request("/api/fs/find?directory=relative&query=src&limit=20"),
    ])

    expect(responses.map((response) => response.status)).toEqual([400, 400, 400])
    expect(domain.finds).toEqual([])
  })

  test("maps expected filesystem failures", async () => {
    database = createTestDatabase().database
    const domain = fileDomain()
    const failures = [
      Object.assign(new Error("missing"), { _tag: "PlatformError", reason: "NotFound" }),
      Object.assign(new Error("denied"), { _tag: "PlatformError", reason: "PermissionDenied" }),
      new Error("Path is not a directory"),
      new Error("Path escapes the location"),
    ]
    domain.listFiles = async () => {
      throw failures.shift()
    }
    const app = createApp({ database, domain })
    const responses = await Promise.all(
      failures.map(() => Promise.resolve(app.request("/api/fs/list?directory=%2Ftmp%2Fproject"))),
    )

    expect(responses.map((response) => response.status)).toEqual([404, 400, 400, 400])
    expect(await Promise.all(responses.map((response) => response.json()))).toEqual([
      { error: { code: "not_found", message: "Path not found" } },
      { error: { code: "validation", message: "Path is unavailable" } },
      { error: { code: "validation", message: "Path is unavailable" } },
      { error: { code: "validation", message: "Path is unavailable" } },
    ])
  })

  test("maps filesystem failures wrapped during directory enumeration", async () => {
    database = createTestDatabase().database
    const domain = fileDomain()
    const failures = [
      Object.assign(new Error("enumeration failed"), {
        _tag: "FileSystemError",
        cause: Object.assign(new Error("missing"), { code: "ENOENT" }),
      }),
      Object.assign(new Error("enumeration failed"), {
        _tag: "FileSystemError",
        cause: Object.assign(new Error("denied"), { code: "EACCES" }),
      }),
    ]
    domain.listFiles = async () => {
      throw failures.shift()
    }
    const app = createApp({ database, domain })
    const responses = await Promise.all(
      failures.map(() => Promise.resolve(app.request("/api/fs/list?directory=%2Ftmp%2Fproject"))),
    )

    expect(responses.map((response) => response.status)).toEqual([404, 400])
  })
})

function fileDomain(): CoreDomain & { finds: unknown[]; lists: unknown[] } {
  const finds: unknown[] = []
  const lists: unknown[] = []
  const unavailable = () => Promise.reject(new Error("unused"))
  return {
    finds,
    lists,
    ready: async () => {},
    createSession: unavailable,
    admitPrompt: unavailable,
    interrupt: unavailable,
    cancelInput: unavailable,
    reorderInputs: unavailable,
    listFiles: async (input) => {
      lists.push(input)
      return []
    },
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
