import { describe, expect, test } from "bun:test"
import type { ProjectChat } from "@hena/sdk/v2/client"
import { createProjectChatCache } from "./project-chat-cache"

const chat = (id: string): ProjectChat => ({
  id,
  name: id,
  directory: `hena://project/${id}`,
  time: { created: 1, updated: 1 },
})

describe("createProjectChatCache", () => {
  test("keeps API newest-first ordering and puts optimistic creates first", async () => {
    const cache = createProjectChatCache()
    await cache.load(async () => [chat("new"), chat("old")])
    cache.upsert(chat("optimistic"))

    expect(cache.list().map((item) => item.id)).toEqual(["optimistic", "new", "old"])
  })

  test("does not let an older response resurrect a newer tombstone", async () => {
    const cache = createProjectChatCache()
    let resolveOld!: (value: ProjectChat[]) => void
    let resolveNew!: (value: ProjectChat[]) => void
    const old = cache.load(() => new Promise((resolve) => (resolveOld = resolve)))
    cache.remove("removed")
    const current = cache.load(() => new Promise((resolve) => (resolveNew = resolve)))

    resolveNew([])
    await current
    resolveOld([chat("removed")])
    await old

    expect(cache.list()).toEqual([])
  })

  test("retains an optimistic create until a request started after it confirms it", async () => {
    const cache = createProjectChatCache()
    let resolveOld!: (value: ProjectChat[]) => void
    const old = cache.load(() => new Promise((resolve) => (resolveOld = resolve)))
    cache.upsert(chat("created"))
    resolveOld([])
    await old
    expect(cache.list().map((item) => item.id)).toEqual(["created"])

    await cache.load(async () => [chat("created")])
    expect(cache.list().map((item) => item.id)).toEqual(["created"])
  })

  test("does not mark a failed initial load as authoritative", async () => {
    const cache = createProjectChatCache()
    await cache.load(async () => Promise.reject(new Error("offline"))).catch(() => cache.list())

    expect(cache.loaded()).toBe(false)
  })
})
