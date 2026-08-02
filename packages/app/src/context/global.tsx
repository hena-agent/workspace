import { createSimpleContext } from "@hena/ui/context"
import { createEffect, createMemo, createResource, createRoot, onCleanup } from "solid-js"
import type { ProjectChat } from "@hena/sdk/v2/client"
import { createStore } from "solid-js/store"
import { createServerProjects, RECENTLY_CLOSED_DISPLAY_LIMIT, ServerConnection, useServer } from "./server"
import { pathKey } from "@/utils/path-key"
import { useServerHealth } from "@/utils/server-health"
import { createServerSdkContext } from "./server-sdk"
import { createServerSyncContext } from "./server-sync"
import { getOwner } from "solid-js/web"
import { QueryClient } from "@tanstack/solid-query"
import type { ServerScope } from "@/utils/server-scope"

export const { use: useGlobal, provider: GlobalProvider } = createSimpleContext({
  name: "Global",
  init: () => {
    const server = useServer()
    const serverHealth = useServerHealth(
      () => server.list,
      () => true,
    )
    const [store, setStore] = createStore({
      settings: {
        serverKey: undefined as ServerConnection.Key | undefined,
      },
    })

    const settingsServer = createMemo(() => {
      const list = server.list
      return list.find((conn) => ServerConnection.key(conn) === store.settings.serverKey) ?? list[0]
    })

    createEffect(() => {
      const conn = settingsServer()
      const key = conn ? ServerConnection.key(conn) : undefined
      if (store.settings.serverKey !== key) setStore("settings", "serverKey", key)
    })

    const serverCtxs = new Map<
      ServerConnection.Key,
      { dispose: () => void; serverCtx: ReturnType<typeof createServerCtx> }
    >()

    const owner = getOwner()

    const ensureServerCtx = (conn: ServerConnection.Any) => {
      const key = ServerConnection.key(conn)
      const existing = serverCtxs.get(key)
      if (existing) return existing.serverCtx
      const root = createRoot((dispose) => {
        const serverCtx = createServerCtx(conn, server.scope(key), server.projects.forServer(key))
        return { dispose, serverCtx }
      }, owner as any)
      serverCtxs.set(key, root)
      return root.serverCtx
    }

    createMemo(() => {
      for (const conn of server.list) {
        ensureServerCtx(conn)
      }
    })

    createEffect(() => {
      for (const [key] of serverCtxs) {
        if (!server.list.find((conn) => ServerConnection.key(conn) === key)) {
          const { dispose } = serverCtxs.get(key)!
          dispose()
          serverCtxs.delete(key)
        }
      }
    })

    return {
      servers: {
        list: () => server.list,
        health: serverHealth,
      },
      settings: {
        server: {
          get key() {
            return store.settings.serverKey
          },
          selected: settingsServer,
          set(key: ServerConnection.Key) {
            if (store.settings.serverKey !== key) setStore("settings", "serverKey", key)
          },
        },
      },
      ensureServerCtx(conn: ServerConnection.Any) {
        return ensureServerCtx(conn)
      },
    }
  },
})

function createServerCtx(
  conn: ServerConnection.Any,
  scope: ServerScope,
  projects: ReturnType<typeof createServerProjects>,
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnReconnect: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
      },
    },
  })
  const sdk = createServerSdkContext(conn, scope)
  const sync = createServerSyncContext(sdk)
  const chatOverrides = new Map<string, ProjectChat | undefined>()
  let latestChats: ProjectChat[] | undefined
  const [chats, { mutate: setChats, refetch: refetchChats }] = createResource(() =>
    sdk.client.v2.project
      .list()
      .then((response) => response.data ?? [])
      .then((items) => {
        const merged = new Map(items.map((item) => [item.id, item]))
        for (const [id, chat] of chatOverrides) {
          if (chat && merged.has(id)) chatOverrides.delete(id)
          if (!chat && !merged.has(id)) chatOverrides.delete(id)
          if (chat) merged.set(id, chat)
          else merged.delete(id)
        }
        return [...merged.values()]
      }),
  )

  createEffect(() => {
    if (chats.error) return
    const value = chats()
    if (value) latestChats = value
  })

  const stopProjectRefresh = sdk.event.listen((event) => {
    if (event.name !== "global") return
    if (
      event.details.type !== "server.connected" &&
      event.details.type !== "global.disposed" &&
      !event.details.type.startsWith("project.")
    )
      return
    void refetchChats()
  })
  onCleanup(stopProjectRefresh)
  const chatList = () => (chats.error ? latestChats : chats())

  createEffect(() =>
    chatList()
      ?.filter((chat) => !projects.closed(chat.directory))
      .forEach((chat) => projects.open(chat.directory)),
  )

  function enrich(project: { worktree: string; expanded: boolean }) {
    const [childStore] = sync.child(project.worktree, { bootstrap: false })
    const projectID = childStore.project
    const chat = chatList()?.find(
      (item) => item.id === projectID || pathKey(item.directory) === pathKey(project.worktree),
    )
    const metadata = projectID
      ? sync.data.project.find((x) => x.id === projectID)
      : sync.data.project.find((x) => x.worktree === project.worktree)

    // Preserve local icon override from per-workspace localStorage cache (childStore.icon).
    // Without this, different subdirectories of the same git repo would share the same
    // icon from the database instead of using their individual overrides.
    const base = {
      id: chat?.id ?? metadata?.id,
      worktree: project.worktree,
      expanded: project.expanded,
      name: chat?.name ?? metadata?.name,
      vcs: metadata?.vcs,
      commands: metadata?.commands,
      sandboxes: metadata?.sandboxes ?? [],
      time: metadata?.time ?? chat?.time,
      icon: metadata?.icon,
    }
    if (childStore.icon) {
      return { ...base, icon: { ...base.icon, override: childStore.icon } }
    }
    return base
  }

  const projectsList = createMemo(() => projects.list().map(enrich))
  const recentlyClosedList = createMemo(() => {
    const known = new Set([
      ...sync.data.project.map((project) => pathKey(project.worktree)),
      ...(chatList()?.map((chat) => pathKey(chat.directory)) ?? []),
    ])
    return projects
      .recentlyClosed()
      .filter((worktree) => known.has(pathKey(worktree)))
      .slice(0, RECENTLY_CLOSED_DISPLAY_LIMIT)
      .map((worktree) => enrich({ worktree, expanded: false }))
  })

  const isLocal =
    (conn?.type === "sidecar" && conn.variant === "base") || (conn?.type === "http" && isLocalHost(conn.http.url))

  const createChat = async (name: string) => {
    const response = await sdk.client.v2.project.create({ projectCreateInput: { name } })
    if (!response.data) throw response.error
    const chat = response.data
    chatOverrides.set(chat.id, chat)
    latestChats = [chat, ...(latestChats ?? []).filter((item) => item.id !== chat.id)]
    setChats(latestChats)
    projects.open(chat.directory)
    projects.touch(chat.directory)
    void refetchChats()
    return { chat, directory: chat.directory }
  }

  const attachFolder = async (projectID: string, folder: string) => {
    const chat = (chatList() ?? []).find((item) => item.id === projectID)
    if (!chat) throw new Error(`Chat project not found: ${projectID}`)
    const response = await sdk.client.v2.project.attachFolder({ projectID, folder })
    if (!response.data) throw response.error
    const attachment = response.data
    chatOverrides.set(projectID, undefined)
    latestChats = (latestChats ?? []).filter((item) => item.id !== projectID)
    setChats(latestChats)
    projects.replace(chat.directory, attachment.project.directory)
    void refetchChats()
    await Promise.all(
      attachment.sessionIDs.map((sessionID) => sync.session.resolve(sessionID, { force: true }).catch(() => {})),
    )
    await sync.homeSessions.invalidate().catch(() => {})
    return {
      project: attachment.project,
      sessionIDs: attachment.sessionIDs,
      previous: chat.directory,
      directory: attachment.project.directory,
    }
  }

  return {
    queryClient,
    sdk,
    sync,
    isLocal,
    projects: {
      ...projects,
      list: projectsList,
      recentlyClosed: recentlyClosedList,
      chats: () => chatList() ?? [],
      createChat,
      attachFolder,
    },
  }
}

export type ServerCtx = ReturnType<typeof createServerCtx>

function isLocalHost(url: string) {
  const host = url.replace(/^https?:\/\//, "").split(":")[0]
  if (host === "localhost" || host === "127.0.0.1") return "local"
}
