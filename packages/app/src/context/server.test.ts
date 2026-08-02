import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import {
  createServerProjects,
  migrateCanonicalLocalServerState,
  nextServerAfterRemoval,
  resolveServerList,
  ServerConnection,
} from "./server"
import { ServerScope } from "@/utils/server-scope"

describe("resolveServerList", () => {
  test("lets startup auth_token credentials override a persisted same-url server", () => {
    const list = resolveServerList({
      stored: [{ url: "https://server.example.test" }],
      props: [
        {
          type: "http",
          authToken: true,
          http: {
            url: "https://server.example.test",
            username: "hena",
            password: "secret",
          },
        },
      ],
    })

    expect(list).toHaveLength(1)
    expect(list[0]?.type).toBe("http")
    expect(list[0]?.http).toEqual({
      url: "https://server.example.test",
      username: "hena",
      password: "secret",
    })
    expect(list[0]?.type === "http" ? list[0].authToken : false).toBe(true)
    expect(ServerConnection.key(list[0]!) as string).toBe("https://server.example.test")
  })

  test("keeps persisted credentials when startup has no auth_token", () => {
    const list = resolveServerList({
      stored: [
        {
          url: "https://server.example.test",
          username: "hena",
          password: "saved",
        },
      ],
      props: [{ type: "http", http: { url: "https://server.example.test" } }],
    })

    expect(list).toHaveLength(1)
    expect(list[0]?.type).toBe("http")
    expect(list[0]?.http).toEqual({
      url: "https://server.example.test",
      username: "hena",
      password: "saved",
    })
    expect(list[0]?.type === "http" ? list[0].authToken : true).toBeUndefined()
  })
})

test("treats WSL sidecars as remote server connections", () => {
  expect(
    ServerConnection.local({
      type: "sidecar",
      variant: "wsl",
      distro: "Debian",
      http: { url: "http://127.0.0.1:4097" },
    }),
  ).toBe(false)
  expect(ServerConnection.local({ type: "sidecar", variant: "base", http: { url: "http://127.0.0.1:4096" } })).toBe(
    true,
  )
  expect(ServerConnection.local({ type: "http", http: { url: "http://localhost:4096" } })).toBe(true)
  expect(ServerConnection.local({ type: "http", http: { url: "https://server.example.test" } })).toBe(false)
})

test("active server removal falls back across built-in and persisted servers", () => {
  const local = { type: "sidecar", variant: "base", http: { url: "http://127.0.0.1:4096" } } as const
  const debian = {
    type: "sidecar",
    variant: "wsl",
    distro: "Debian",
    http: { url: "http://127.0.0.1:4097" },
  } as const

  expect(
    nextServerAfterRemoval(
      [local, debian],
      ServerConnection.Key.make("wsl:Debian"),
      ServerConnection.Key.make("sidecar"),
    ),
  ).toBe(ServerConnection.Key.make("sidecar"))
})

describe("createServerProjects", () => {
  test("keeps active and explicit server buckets in one reactive store", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({ projects: {}, lastProject: {}, recentlyClosed: {} })
      const active = createServerProjects({ scope, store, setStore })
      const remote = createServerProjects({ scope: () => "https://debian.example" as ServerScope, store, setStore })

      remote.open("/repo")
      expect(remote.list()).toEqual([{ worktree: "/repo", expanded: true }])
      expect(active.list()).toEqual([])

      const adopted = createServerProjects({ scope: () => "https://debian.example" as ServerScope, store, setStore })
      expect(adopted.list()).toEqual([{ worktree: "/repo", expanded: true }])

      adopted.close("/repo")
      expect(remote.list()).toEqual([])
      dispose()
    })
  })

  test("tracks recently closed projects and drops them when reopened", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({ projects: {}, lastProject: {}, recentlyClosed: {} })
      const projects = createServerProjects({ scope, store, setStore })

      projects.open("/a")
      projects.open("/b")
      projects.close("/a")
      expect(projects.recentlyClosed()).toEqual(["/a"])
      expect(projects.closed("/a/")).toBe(true)
      expect(projects.closed("/b")).toBe(false)

      projects.close("/b")
      expect(projects.recentlyClosed()).toEqual(["/b", "/a"])

      projects.open("/a")
      expect(projects.recentlyClosed()).toEqual(["/b"])
      expect(projects.list()).toEqual([{ worktree: "/a", expanded: true }])
      dispose()
    })
  })

  test("remove drops a project without recording it as recently closed", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({ projects: {}, lastProject: {}, recentlyClosed: {} })
      const projects = createServerProjects({ scope, store, setStore })

      projects.open("/repo/subdir")
      projects.remove("/repo/subdir/")
      expect(projects.list()).toEqual([])
      expect(projects.recentlyClosed()).toEqual([])
      dispose()
    })
  })

  test("replaces a normalized route in place and preserves expansion and order", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({ projects: {}, lastProject: {}, recentlyClosed: {} })
      const projects = createServerProjects({ scope, store, setStore })

      projects.open("/before")
      projects.open("/scratch/project/")
      projects.collapse("/scratch/project")
      projects.open("/after")
      projects.touch("/scratch/project")
      projects.replace("/scratch/project/", "/attached/project/")

      expect(projects.list()).toEqual([
        { worktree: "/after", expanded: true },
        { worktree: "/attached/project", expanded: false },
        { worktree: "/before", expanded: true },
      ])
      expect(projects.last()).toBe("/attached/project")
      expect(projects.recentlyClosed()).toEqual([])
      dispose()
    })
  })

  test("dedupes an existing destination without moving the source slot", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({
        projects: {
          local: [
            { worktree: "/scratch", expanded: false },
            { worktree: "/other", expanded: true },
            { worktree: "/target/", expanded: true },
          ],
        },
        lastProject: {},
        recentlyClosed: {},
      })
      const projects = createServerProjects({ scope, store, setStore })

      projects.replace("/scratch/", "/target")

      expect(projects.list()).toEqual([
        { worktree: "/target", expanded: false },
        { worktree: "/other", expanded: true },
      ])
      dispose()
    })
  })

  test("removes a closed source when its replacement is already active", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({
        projects: { local: [{ worktree: "/destination", expanded: true }] },
        recentlyClosed: { local: ["/scratch"] },
        lastProject: {},
      })
      const projects = createServerProjects({ scope, store, setStore })

      projects.replace("/scratch", "/destination")

      expect(projects.list()).toEqual([{ worktree: "/destination", expanded: true }])
      expect(projects.recentlyClosed()).toEqual([])
      dispose()
    })
  })

  test("keeps an active source open when the destination was previously closed", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({
        projects: { local: [{ worktree: "/scratch", expanded: false }] },
        lastProject: {},
        recentlyClosed: { local: ["/target/"] },
      })
      const projects = createServerProjects({ scope, store, setStore })

      projects.replace("/scratch/", "/target")

      expect(projects.list()).toEqual([{ worktree: "/target", expanded: false }])
      expect(projects.recentlyClosed()).toEqual([])
      dispose()
    })
  })

  test("handles equal normalized source and destination paths", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({ projects: {}, lastProject: {}, recentlyClosed: {} })
      const projects = createServerProjects({ scope, store, setStore })

      projects.open("/folder/")
      projects.replace("/folder", "/folder/")

      expect(projects.list()).toEqual([{ worktree: "/folder", expanded: true }])
      dispose()
    })
  })

  test("preserves closed state while migrating recently closed paths", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({ projects: {}, lastProject: {}, recentlyClosed: {} })
      const projects = createServerProjects({ scope, store, setStore })

      projects.open("/scratch")
      projects.close("/scratch/")
      projects.replace("/scratch", "/folder/")

      expect(projects.list()).toEqual([])
      expect(projects.recentlyClosed()).toEqual(["/folder"])
      expect(projects.closed("/folder/")).toBe(true)
      dispose()
    })
  })

  test("dedupes migrated recently closed targets and updates normalized last project", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({
        projects: {},
        lastProject: { local: "/scratch/" },
        recentlyClosed: { local: ["/target/", "/scratch", "/other"] },
      })
      const projects = createServerProjects({ scope, store, setStore })

      projects.replace("/scratch", "/target")

      expect(projects.list()).toEqual([])
      expect(projects.last()).toBe("/target")
      expect(projects.recentlyClosed()).toEqual(["/target", "/other"])
      dispose()
    })
  })

  test("normalizes paths for persisted project operations", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({ projects: {}, lastProject: {}, recentlyClosed: {} })
      const projects = createServerProjects({ scope, store, setStore })

      projects.open("/first/")
      projects.open("/second")
      projects.collapse("/first/")
      projects.move("/first/", 0)
      projects.touch("/first/")

      expect(projects.list()).toEqual([
        { worktree: "/first", expanded: false },
        { worktree: "/second", expanded: true },
      ])
      expect(projects.last()).toBe("/first")
      dispose()
    })
  })

  test("reconciles identified chat routes without removing folder projects", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({
        projects: {
          local: [
            { worktree: "/folder", expanded: true },
            { worktree: "hena://project/stale", expanded: false },
            { worktree: "hena://project/current", expanded: true, type: "chat" as const, id: "current" },
          ],
        },
        lastProject: {},
        recentlyClosed: { local: ["hena://project/stale-closed"] },
      })
      const projects = createServerProjects({ scope, store, setStore })

      expect(
        projects.reconcileChats([
          { id: "newest", directory: "hena://project/newest" },
          { id: "current", directory: "hena://project/current" },
        ]),
      ).toEqual(["stale"])
      expect(projects.list()).toEqual([
        { worktree: "hena://project/newest", expanded: true, type: "chat", id: "newest" },
        { worktree: "/folder", expanded: true },
        { worktree: "hena://project/current", expanded: true, type: "chat", id: "current" },
      ])
      expect(projects.recentlyClosed()).toEqual([])
      dispose()
    })
  })

  test("replaces a remotely attached chat by stored identity", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({
        projects: {
          local: [
            { worktree: "/other", expanded: true },
            { worktree: "hena://project/chat", expanded: false, type: "chat" as const, id: "chat" },
          ],
        },
        lastProject: { local: "hena://project/chat" },
        recentlyClosed: {},
      })
      const projects = createServerProjects({ scope, store, setStore })

      expect(projects.replaceChat("chat", "/attached/repo")).toBe("hena://project/chat")
      expect(projects.list()).toEqual([
        { worktree: "/other", expanded: true },
        { worktree: "/attached/repo", expanded: false },
      ])
      expect(projects.last()).toBe("/attached/repo")
      dispose()
    })
  })

  test("retains recently closed history beyond the visible display limit", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({ projects: {}, lastProject: {}, recentlyClosed: {} })
      const projects = createServerProjects({ scope, store, setStore })

      // Closing 6 projects keeps all 6 in the store even though only 5 are displayed;
      // this prevents display-filtered entries from evicting still-visible ones.
      for (const dir of ["/1", "/2", "/3", "/4", "/5", "/6"]) {
        projects.open(dir)
        projects.close(dir)
      }
      expect(projects.recentlyClosed()).toEqual(["/6", "/5", "/4", "/3", "/2", "/1"])
      dispose()
    })
  })

  test("caps recently closed history at the store limit", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({ projects: {}, lastProject: {}, recentlyClosed: {} })
      const projects = createServerProjects({ scope, store, setStore })

      for (let i = 1; i <= 20; i++) {
        projects.open(`/p${i}`)
        projects.close(`/p${i}`)
      }
      expect(projects.recentlyClosed()).toHaveLength(16)
      expect(projects.recentlyClosed()[0]).toBe("/p20")
      expect(projects.recentlyClosed().at(-1)).toBe("/p5")
      dispose()
    })
  })

  test("dedupes recently closed entries by normalized path", () => {
    createRoot((dispose) => {
      const [scope] = createSignal(ServerScope.local)
      const [store, setStore] = createStore({ projects: {}, lastProject: {}, recentlyClosed: {} })
      const projects = createServerProjects({ scope, store, setStore })

      projects.close("/repo")
      projects.close("/repo/")
      expect(projects.recentlyClosed()).toEqual(["/repo"])
      dispose()
    })
  })
})

describe("migrateCanonicalLocalServerState", () => {
  test("moves an existing canonical web bucket into local scope", () => {
    expect(
      migrateCanonicalLocalServerState(
        {
          list: [],
          projects: { "https://hena.example.com": [{ worktree: "/remote", expanded: true }] },
          lastProject: { "https://hena.example.com": "/remote" },
        },
        ServerConnection.Key.make("https://hena.example.com"),
      ),
    ).toEqual({
      list: [],
      projects: { local: [{ worktree: "/remote", expanded: true }] },
      lastProject: { local: "/remote" },
    })
  })

  test("preserves existing local state while merging a canonical web bucket", () => {
    expect(
      migrateCanonicalLocalServerState(
        {
          projects: {
            local: [{ worktree: "/local", expanded: false }],
            "https://hena.example.com": [
              { worktree: "/local", expanded: true },
              { worktree: "/remote", expanded: true },
            ],
          },
          lastProject: { local: "/local", "https://hena.example.com": "/remote" },
        },
        ServerConnection.Key.make("https://hena.example.com"),
      ),
    ).toEqual({
      projects: {
        local: [
          { worktree: "/local", expanded: false },
          { worktree: "/remote", expanded: true },
        ],
      },
      lastProject: { local: "/local" },
    })
  })
})
