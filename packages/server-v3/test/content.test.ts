import { afterEach, describe, expect, test } from "bun:test"
import { createApp } from "../src/app"
import type { SyncDatabase } from "../src/storage/database"
import { createTestDatabase } from "./fixture"
import { preview } from "../src/storage/content"

describe("full content", () => {
  let database: SyncDatabase | undefined

  afterEach(() => database?.close())

  test("pages on UTF-8 code point boundaries", async () => {
    database = createTestDatabase().database
    database.content.put({ id: "content-1", sessionID: "session-1", revision: "r1", text: "a😀b" })
    const response = await createApp({ database }).request("/api/content/content-1?sessionID=session-1&revision=r1&offset=0&limit=5")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ text: "a😀", offset: 0, nextOffset: 5, totalBytes: 6, revision: "r1" })
  })

  test("rejects offsets in the middle of a code point", async () => {
    database = createTestDatabase().database
    database.content.put({ id: "content-1", sessionID: "session-1", revision: "r1", text: "a😀b" })
    const response = await createApp({ database }).request("/api/content/content-1?sessionID=session-1&revision=r1&offset=2")

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: "validation" } })
  })

  test("advances past a code point larger than the requested limit", async () => {
    database = createTestDatabase().database
    database.content.put({ id: "content-1", sessionID: "session-1", revision: "r1", text: "😀b" })
    const response = await createApp({ database }).request("/api/content/content-1?sessionID=session-1&revision=r1&offset=0&limit=1")

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ text: "😀", offset: 0, nextOffset: 4 })
  })

  test("fails closed for a different owning session or revision", async () => {
    database = createTestDatabase().database
    database.content.put({ id: "content-1", sessionID: "session-1", revision: "r1", text: "secret" })
    const app = createApp({ database })

    expect((await app.request("/api/content/content-1?sessionID=session-2&revision=r1")).status).toBe(404)
    expect((await app.request("/api/content/content-1?sessionID=session-1&revision=r2")).status).toBe(404)
  })

  test("builds UTF-8-safe bounded previews", () => {
    const result = preview(`${"line\n".repeat(500)}😀`, 32 * 1024, 500)

    expect(result.truncated).toBe(true)
    expect(result.totalLines).toBe(501)
    expect(result.text).not.toContain("😀")
  })

  test("removes content after its collection revision leaves retention", () => {
    database = createTestDatabase().database
    database.content.put({ id: "content-1", sessionID: "session-1", revision: "r1", text: "old" })
    database.collections.write({
      collection: "parts",
      scopeKey: "session-1",
      rowKey: "part-1",
      row: { content: { id: "content-1", revision: "r1", bytes: 3 } },
      revision: "row-1",
    })
    database.content.put({ id: "content-1", sessionID: "session-1", revision: "r2", text: "current" })
    database.collections.write({
      collection: "parts",
      scopeKey: "session-1",
      rowKey: "part-1",
      row: { content: { id: "content-1", revision: "r2", bytes: 7 } },
      revision: "row-2",
    })

    database.compact({ changeMaxRows: 1, changeMaxAgeMs: Number.MAX_SAFE_INTEGER })

    expect(
      database.content.page({ id: "content-1", sessionID: "session-1", revision: "r1", offset: 0, limit: 10 }),
    ).toBeUndefined()
    expect(
      database.content.page({ id: "content-1", sessionID: "session-1", revision: "r2", offset: 0, limit: 10 })?.text,
    ).toBe("current")
  })
})
