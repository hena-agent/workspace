import { afterEach, describe, expect, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router"
import userEvent from "@testing-library/user-event"
import { ThemeProvider } from "@/components/theme-provider"
import { ConnectionProvider } from "@/connection/provider"
import { markSessionOpened } from "@/local-state/recent"
import { encodeServerSlug } from "@/lib/server-url"
import { mockMatchMedia } from "@/test/mock-match-media"
import { act, fireEvent, render, screen, waitFor, within } from "@/test/test-utils"
import { routeTree } from "./routeTree.gen"

const origin = "http://localhost:4096"
const slug = encodeServerSlug(origin)
const originalInnerWidth = window.innerWidth
afterEach(() => {
  localStorage.removeItem("hena.connections.v1")
  localStorage.removeItem("hena.tombstones.v1")
  localStorage.removeItem(`hena.recent.v1.${slug}`)
  Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth })
})

function renderApp(initialPath: string, fetcher = collectionFetcher(), options: { desktop?: boolean } = {}) {
  mockMatchMedia(options.desktop ?? true)
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialPath] }) })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ThemeProvider>
        <ConnectionProvider embeddedOrigin={origin} fetcher={fetcher}>
          <RouterProvider router={router} />
        </ConnectionProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  )
  return router
}

type StoredRow = { key: string; revision: string; row: unknown }
type PushedChange = {
  seq: number
  collection: string
  scopeKey: string
  rowKey: string | readonly string[]
  op: "insert" | "update" | "delete"
  row: unknown
  rowRevision?: string
  txid?: string
}

// Mimics a real server's durable collection storage: rows pushed while connected are
// remembered so a *reconnect* (which happens whenever the client re-subscribes, e.g. after
// `agent.claim` fires again) still sees them in its fresh snapshot, exactly like server-v3's
// SQLite-backed `collection_row` table would.
function collectionDatabase(extraRepoSessions = 0) {
  const repoProject = { id: "global", worktree: "/repo", name: "Repo", time: { created: 1, updated: 1 } }
  const docsProject = { id: "docs", worktree: "/docs", name: "Docs", time: { created: 2, updated: 2 } }
  const repoLocationKey = JSON.stringify({ directory: "/repo" })
  const docsLocationKey = JSON.stringify({ directory: "/docs" })
  const liveSession = {
    id: "ses_live",
    projectID: "global",
    title: "Live session",
    location: { directory: "/repo" },
    working: false,
    time: { created: 1, updated: 1 },
  }
  const docsSession = {
    id: "ses_docs",
    projectID: "docs",
    title: "Docs session",
    location: { directory: "/docs" },
    working: false,
    time: { created: 2, updated: 2 },
  }
  const collections: Record<string, Map<string, StoredRow>> = {
    projects: new Map([
      ["global", { key: "global", revision: "1", row: repoProject }],
      ["docs", { key: "docs", revision: "1", row: docsProject }],
    ]),
    locations: new Map([
      [repoLocationKey, { key: repoLocationKey, revision: "1", row: { directory: "/repo" } }],
      [docsLocationKey, { key: docsLocationKey, revision: "1", row: { directory: "/docs" } }],
    ]),
    sessions: new Map([
      ["ses_live", { key: "ses_live", revision: "1", row: liveSession }],
      ["ses_docs", { key: "ses_docs", revision: "1", row: docsSession }],
      ...Array.from({ length: extraRepoSessions }, (_, index) => {
        const id = `ses_extra_${index}`
        return [id, {
          key: id,
          revision: "1",
          row: {
            id,
            projectID: "global",
            title: `Session ${index}`,
            location: { directory: "/repo" },
            working: false,
            time: { created: index + 2, updated: index + 2 },
          },
        }] as const
      }),
    ]),
    permissions: new Map(),
    questions: new Map(),
  }
  const controllers = new Set<(changes: readonly PushedChange[]) => void>()
  return {
    snapshot(collection: string) {
      return Array.from(collections[collection]?.values() ?? [])
    },
    subscribe(push: (changes: readonly PushedChange[]) => void) {
      controllers.add(push)
      return () => controllers.delete(push)
    },
    push(changes: readonly PushedChange[]) {
      changes.forEach((change) => {
        const key = typeof change.rowKey === "string" ? change.rowKey : JSON.stringify(change.rowKey)
        collections[change.collection]?.set(key, { key, revision: change.rowRevision ?? "1", row: change.row })
      })
      controllers.forEach((push) => push(changes))
    },
  }
}

function collectionFetcher(options: {
  onCreateSession?: (request: Request, push: ReturnType<typeof collectionDatabase>["push"]) => Promise<Response>
  beforeSessionSnapshot?: () => Promise<void>
  extraRepoSessions?: number
  onSessionSubscription?: (sessions: readonly string[]) => void
} = {}) {
  const database = collectionDatabase(options.extraRepoSessions)
  let subscribedSessions: string[] = []
  let subscriptionRevision = 0
  let changeSeq = 900
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const path = new URL(request.url).pathname
    if (path === "/api/collection/capabilities")
      return Response.json({ feedId: "feed", protocol: { min: 1, max: 1 }, auth: "none" })
    if (path === "/api/collection/streams" && request.method === "POST")
      return Response.json({ streamId: "stream", generation: 1, expiresAt: Date.now() + 300_000, feed: { feedId: "feed", runtimeId: "runtime", retainedFloor: 0 }, subscriptionRevision: 0 })
    if (path === "/api/collection/streams/stream/subscription") {
      const subscription = await request.json() as { sessions: string[] }
      subscribedSessions = subscription.sessions
      options.onSessionSubscription?.(subscription.sessions)
      subscriptionRevision++
      return Response.json({ generation: 1, revision: subscriptionRevision })
    }
    if (path === "/api/collection/streams/stream/events")
      return eventResponse(request.signal, database, subscribedSessions, subscriptionRevision, options.beforeSessionSnapshot)
    if (path === "/api/catalog")
      return Response.json({
        agents: [{ id: "build", description: "Builds things" }],
        models: [{ id: "gpt", providerID: "openai", name: "GPT", limit: {} }],
        providers: [{ id: "openai", name: "OpenAI" }],
      })
    if (path === "/api/fs/resolve") {
      const input = new URL(request.url).searchParams.get("path")
      return Response.json({ directory: input?.startsWith("~/") ? `/Users/server/${input.slice(2)}` : input })
    }
    if (path === "/api/fs/list") return Response.json({ data: [{ path: "README.md", type: "file" }] })
    if (path === "/api/fs/find") return Response.json({ data: [{ path: "README.md", type: "file" }] })
    if (path === "/api/fs/read") return Response.json({ text: "# Repo", totalBytes: 6 })
    if (path === "/api/session" && request.method === "POST" && options.onCreateSession)
      return options.onCreateSession(request, (changes) => database.push(changes))
    if (path === "/api/session/read" && request.method === "POST") {
      const body = await request.json() as { idempotencyKey: string; sessionIDs: string[] }
      const txid = `tx-read-${body.idempotencyKey}`
      const changes = body.sessionIDs.flatMap((sessionID) => {
        const existing = database.snapshot("sessions").find((entry) => entry.key === sessionID)
        const row = existing?.row as { time?: { updated?: number }; read?: number } | undefined
        if (!row?.time?.updated) return []
        // Mirrors the server's idempotent guard (time_read IS NULL OR time_read < time_updated):
        // an already-read session produces no change, matching a real `noop` receipt.
        if (row.read !== undefined && row.read >= row.time.updated) return []
        return [{
          seq: changeSeq++,
          collection: "sessions",
          scopeKey: "",
          rowKey: sessionID,
          op: "update" as const,
          txid,
          row: { ...row, read: row.time.updated },
        }]
      })
      database.push(changes)
      return Response.json({
        receipt: {
          txid,
          outcome: changes.length > 0 ? "applied" : "noop",
          through: { feedId: "feed", seq: changeSeq },
          affectedScopes: changes.length > 0 ? [{ collection: "sessions", scopeKey: "" }] : [],
        },
      })
    }
    return Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 })
  }
}

function eventResponse(
  signal: AbortSignal,
  database: ReturnType<typeof collectionDatabase>,
  sessions: readonly string[],
  subscriptionRevision: number,
  beforeSessionSnapshot?: () => Promise<void>,
) {
  const scopes = ["projects", "locations", "sessions", "permissions", "questions"]
    .map((collection) => ({ collection, scopeKey: "" }))
  const common = { protocolVersion: 1, feedId: "feed", runtimeId: "runtime", streamId: "stream", generation: 1, subscriptionRevision }
  const frames = scopes.flatMap((scope, index) => {
    const rows = database.snapshot(scope.collection)
    const snapshotId = `snapshot-${index}`
    return [
      { ...common, type: "snapshot.begin", snapshotId, baseSeq: 0, replace: true, scope },
      { ...common, type: "snapshot.page", snapshotId, scope, rows },
      { ...common, type: "snapshot.end", snapshotId, scope, keyCount: rows.length, throughSeq: 0 },
    ]
  })
  return new Response(new ReadableStream({
    async start(controller) {
      controller.enqueue(new TextEncoder().encode(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")))
      const unsubscribe = database.subscribe((changes) => {
        const affectedScopes = [{ collection: "sessions", scopeKey: "" }, { collection: "projects", scopeKey: "" }]
        const frame = { ...common, type: "rows", affectedScopes, fromSeq: 1, throughSeq: 101, changes }
        try {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`))
        } catch {
          unsubscribe()
        }
      })
      signal.addEventListener("abort", () => {
        unsubscribe()
        controller.close()
      }, { once: true })
      if (signal.aborted || sessions.length === 0) return
      await beforeSessionSnapshot?.()
      if (signal.aborted) return
      const sessionFrames = sessions.flatMap((scopeKey, sessionIndex) =>
        ["messages", "parts"].flatMap((collection, collectionIndex) => {
          const scope = { collection, scopeKey }
          const snapshotId = `session-${sessionIndex}-${collectionIndex}`
          const rows = collection === "messages" ? [{
            key: `message-${scopeKey}`,
            row: { id: `message-${scopeKey}`, type: "user", text: `${scopeKey} transcript`, time: { created: 1 } },
          }] : []
          return [
            { ...common, type: "snapshot.begin", snapshotId, baseSeq: 0, replace: true, scope },
            { ...common, type: "snapshot.page", snapshotId, scope, rows },
            { ...common, type: "snapshot.end", snapshotId, scope, keyCount: rows.length, throughSeq: 0 },
          ]
        }))
      controller.enqueue(new TextEncoder().encode(sessionFrames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")))
    },
  }), { headers: { "content-type": "text/event-stream" } })
}

describe("adding a project through the rail", () => {
  test("the new project appears in the rail and its session appears in the sidebar", async () => {
    const user = userEvent.setup()
    const fetcher = collectionFetcher({
      onCreateSession: async (request, push) => {
        const body = (await request.json()) as { sessionID: string; location: { directory: string } }
        const newSession = {
          id: body.sessionID,
          projectID: "new_proj",
          title: "New project session",
          location: body.location,
          working: false,
          time: { created: 2, updated: 2 },
        }
        const newProject = {
          id: "new_proj",
          worktree: body.location.directory,
          name: "MyNewProject",
          time: { created: 2, updated: 2 },
        }
        push([
          {
            seq: 100,
            collection: "sessions",
            scopeKey: "",
            rowKey: body.sessionID,
            op: "insert",
            txid: "tx-new-project",
            row: newSession,
          },
          {
            seq: 101,
            collection: "projects",
            scopeKey: "",
            rowKey: "new_proj",
            op: "insert",
            txid: "tx-new-project",
            row: newProject,
          },
        ])
        return Response.json({
          session: { id: body.sessionID, projectID: "new_proj" },
          admitted: {
            id: "msg_1",
            sessionID: body.sessionID,
            prompt: { text: "" },
            delivery: "steer",
            admittedSeq: 1,
            queuePosition: 0,
            timeCreated: 2,
          },
          receipt: {
            txid: "tx-new-project",
            outcome: "applied",
            through: { feedId: "feed", seq: 101 },
            affectedScopes: [{ collection: "sessions", scopeKey: "" }, { collection: "projects", scopeKey: "" }],
          },
        })
      },
    })
    renderApp(`/${slug}`, fetcher)

    await user.click(await screen.findByRole("button", { name: "Open project" }))
    const dialog = screen.getByRole("dialog")
    await user.type(within(dialog).getByLabelText("Directory path"), "~/git/ysmdev/sessions{Enter}")

    const pendingRail = screen.getAllByRole("navigation", { name: "Projects" })[0]
    expect(await within(pendingRail).findByRole("button", { name: /sessions/i })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getAllByText("sessions").length).toBeGreaterThan(0)

    await user.type(await screen.findByRole("textbox", { name: "Message" }), "hello from a new project")
    await user.click(screen.getByRole("button", { name: "Send message" }))

    const rail = screen.getAllByRole("navigation", { name: "Projects" })[0]
    const selectedProject = await within(rail).findByRole("button", { name: /MyNewProject/ })
    expect(selectedProject.getAttribute("aria-pressed")).toBe("true")
    expect(selectedProject).toHaveClass("border-2", "border-[var(--legacy-icon-strong)]")
    expect(within(rail).getByRole("button", { name: /Repo/ }).getAttribute("aria-pressed")).toBe("false")
    const sessions = screen.getAllByRole("navigation", { name: "Sessions" })[0]
    expect(await within(sessions).findByText("New project session")).toBeInTheDocument()
  })
})

describe("app routing against server-v3", () => {
  test("redirects the root to the registered server", async () => {
    const router = renderApp("/")

    expect(await screen.findByRole("heading", { name: "Recent projects" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/${slug}`)
  })

  test("opens a synced project and starts a new session draft", async () => {
    const user = userEvent.setup()
    renderApp(`/${slug}/global`)

    const buttons = await screen.findAllByRole("button", { name: "New session" })
    await user.click(buttons.at(-1)!)
    expect(await screen.findByRole("heading", { name: "New session" })).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "Message" })).toBeInTheDocument()
  })

  test("keeps an optimistic prompt visible while its transcript synchronizes", async () => {
    const user = userEvent.setup()
    const mutation = Promise.withResolvers<void>()
    const snapshot = Promise.withResolvers<void>()
    let waitingForSnapshot = false
    const fetcher = collectionFetcher({
      beforeSessionSnapshot: () => {
        waitingForSnapshot = true
        return snapshot.promise
      },
      onCreateSession: async (request, push) => {
        const body = await request.json() as {
          sessionID: string
          messageID: string
          location: { directory: string }
          prompt: { text: string }
        }
        await mutation.promise
        push([{
          seq: 100,
          collection: "sessions",
          scopeKey: "",
          rowKey: body.sessionID,
          op: "insert",
          txid: "tx-new-session",
          row: {
            id: body.sessionID,
            projectID: "global",
            title: body.prompt.text,
            location: body.location,
            working: true,
            time: { created: 2, updated: 2 },
          },
        }])
        return Response.json({
          session: { id: body.sessionID, projectID: "global" },
          admitted: {
            id: body.messageID,
            sessionID: body.sessionID,
            prompt: body.prompt,
            delivery: "steer",
            admittedSeq: 1,
            queuePosition: 0,
            timeCreated: 2,
          },
          receipt: {
            txid: "tx-new-session",
            outcome: "applied",
            through: { feedId: "feed", seq: 100 },
            affectedScopes: [{ collection: "sessions", scopeKey: "" }],
          },
        })
      },
    })
    renderApp(`/${slug}/global`, fetcher)

    const buttons = await screen.findAllByRole("button", { name: "New session" })
    await user.click(buttons.at(-1)!)
    await user.type(await screen.findByRole("textbox", { name: "Message" }), "Pending prompt")
    await user.click(screen.getByRole("button", { name: "Send message" }))
    await waitFor(() => expect(waitingForSnapshot).toBe(true))

    try {
      const log = screen.getByRole("log", { name: "Messages" })
      expect(within(log).getByText("Pending prompt")).toBeInTheDocument()
      expect(within(log).getByText("You · Sending")).toBeInTheDocument()
      expect(within(log).getByText("Thinking...")).toBeInTheDocument()
      await act(async () => mutation.resolve())
      await waitFor(() => expect(within(log).queryByText("You · Sending")).not.toBeInTheDocument())
      expect(within(log).getByText("Pending prompt")).toBeInTheDocument()
      expect(within(log).getByText("Thinking...")).toBeInTheDocument()
    } finally {
      await act(async () => {
        mutation.resolve()
        snapshot.resolve()
      })
    }
  })

  test("redirects legacy review URLs to the centered transcript", async () => {
    const router = renderApp(`/${slug}/global/session/ses_live/review`)

    expect(await screen.findByRole("heading", { name: "Live session" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/${slug}/global/session/ses_live`)
    expect(screen.queryByRole("navigation", { name: "Session views" })).not.toBeInTheDocument()
  })

  test("does not show an empty transcript while session messages synchronize", async () => {
    const user = userEvent.setup()
    const snapshot = Promise.withResolvers<void>()
    let waitingForSnapshot = false
    const router = renderApp(`/${slug}/global`, collectionFetcher({
      beforeSessionSnapshot: () => {
        waitingForSnapshot = true
        return snapshot.promise
      },
    }))

    const sessions = (await screen.findAllByRole("navigation", { name: "Sessions" }))[0]
    await user.click(within(sessions).getByText("Live session"))
    await waitFor(() => expect(waitingForSnapshot).toBe(true))

    try {
      expect(router.state.location.pathname).toBe(`/${slug}/global/session/ses_live`)
      expect(screen.getByRole("heading", { name: "Live session" })).toBeInTheDocument()
      expect(screen.queryByText("No messages yet")).not.toBeInTheDocument()
    } finally {
      snapshot.resolve()
    }
    expect(await screen.findByText("ses_live transcript")).toBeInTheDocument()
  })

  test("opens lower prefetched sessions with pointer and keyboard without reconnecting", async () => {
    const user = userEvent.setup()
    const subscriptions: string[][] = []
    const router = renderApp(`/${slug}/global/session/ses_extra_0`, collectionFetcher({
      extraRepoSessions: 12,
      onSessionSubscription: (sessions) => subscriptions.push([...sessions]),
    }))

    expect(await screen.findByText("ses_extra_0 transcript")).toBeInTheDocument()
    await waitFor(() => expect(subscriptions.at(-1)).toHaveLength(13))
    const subscriptionCount = subscriptions.length
    const sessions = (await screen.findAllByRole("navigation", { name: "Sessions" }))[0]

    await user.click(within(sessions).getByRole("button", { name: /Session 1$/ }))
    expect(router.state.location.pathname).toBe(`/${slug}/global/session/ses_extra_1`)
    expect(screen.getByRole("heading", { name: "Session 1" })).toBeInTheDocument()
    expect(screen.getByText("ses_extra_1 transcript")).toBeInTheDocument()
    expect(screen.queryByText("Connecting to the server...")).not.toBeInTheDocument()
    expect(screen.queryByText("No messages yet")).not.toBeInTheDocument()

    within(sessions).getByRole("button", { name: /Session 2$/ }).focus()
    await user.keyboard("{Enter}")
    expect(router.state.location.pathname).toBe(`/${slug}/global/session/ses_extra_2`)
    expect(screen.getByRole("heading", { name: "Session 2" })).toBeInTheDocument()
    expect(screen.getByText("ses_extra_2 transcript")).toBeInTheDocument()
    await act(async () => Bun.sleep(20))
    expect(subscriptions).toHaveLength(subscriptionCount)
  })

  test("restores the last selected session when switching projects", async () => {
    const user = userEvent.setup()
    const router = renderApp(`/${slug}/global`)

    const sessions = (await screen.findAllByRole("navigation", { name: "Sessions" }))[0]
    await user.click(within(sessions).getByText("Live session"))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/${slug}/global/session/ses_live`))

    const rail = (await screen.findAllByRole("navigation", { name: "Projects" }))[0]
    await user.click(within(rail).getByRole("button", { name: /Docs/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/${slug}/docs`))
    await user.click(within(sessions).getByText("Docs session"))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/${slug}/docs/session/ses_docs`))

    await user.click(within(rail).getByRole("button", { name: /Repo/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/${slug}/global/session/ses_live`))
    expect(screen.getByRole("heading", { name: "Live session" })).toBeInTheDocument()
  })

  test("clears the unread dot after opening a session", async () => {
    const user = userEvent.setup()
    renderApp(`/${slug}/global`)

    const sessions = (await screen.findAllByRole("navigation", { name: "Sessions" }))[0]
    expect(within(sessions).getByLabelText("Unread")).toBeInTheDocument()

    await user.click(within(sessions).getByText("Live session"))

    await waitFor(() => expect(within(sessions).queryByLabelText("Unread")).not.toBeInTheDocument())
  })

  test("Clear notifications marks every unread session in the project as read", async () => {
    const user = userEvent.setup()
    renderApp(`/${slug}/global`, collectionFetcher({ extraRepoSessions: 2 }))

    const sessions = (await screen.findAllByRole("navigation", { name: "Sessions" }))[0]
    await waitFor(() => expect(within(sessions).getAllByLabelText("Unread")).toHaveLength(3))

    await user.click(screen.getAllByRole("button", { name: "Project actions" })[0])
    await user.click(await screen.findByRole("menuitem", { name: "Clear notifications" }))

    await waitFor(() => expect(within(sessions).queryAllByLabelText("Unread")).toHaveLength(0))
  })

  test("a rejected mark-read does not retry in a loop", async () => {
    const user = userEvent.setup()
    let calls = 0
    const base = collectionFetcher()
    const failingReads: typeof base = async (input, init) => {
      const path = new URL(input instanceof Request ? input.url : input.toString(), "http://x").pathname
      if (path === "/api/session/read") {
        calls++
        // A non-transient status (unlike 429/500+) rejects on the first attempt with no
        // `requestQueueable` retry delay, so a rollback -- and any resulting re-trigger -- would
        // happen within this test's short observation window rather than several seconds later.
        return Response.json({ error: { code: "validation", message: "forced failure" } }, { status: 400 })
      }
      return base(input, init)
    }
    renderApp(`/${slug}/global`, failingReads)

    const sessions = (await screen.findAllByRole("navigation", { name: "Sessions" }))[0]
    await user.click(within(sessions).getByText("Live session"))
    await act(async () => { await Bun.sleep(20) })
    const firstWindow = calls
    expect(firstWindow).toBeGreaterThan(0)
    await act(async () => { await Bun.sleep(50) })
    expect(calls).toBe(firstWindow)
  })

  test("restores the last session when opening a recent project", async () => {
    const user = userEvent.setup()
    markSessionOpened(origin, "ses_live")
    const router = renderApp(`/${slug}`)

    await user.click(await screen.findByRole("button", { name: /\/repo/ }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/${slug}/global/session/ses_live`))
    expect(screen.getByRole("heading", { name: "Live session" })).toBeInTheDocument()
  })

  test("falls back to the project overview when session history is stale", async () => {
    markSessionOpened(origin, "ses_missing")
    const router = renderApp(`/${slug}/global`)

    expect(await screen.findByRole("heading", { name: "Repo" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/${slug}/global`)
  })

  test("keeps the project session list on mobile", async () => {
    markSessionOpened(origin, "ses_live")
    const router = renderApp(`/${slug}/global`, collectionFetcher(), { desktop: false })

    expect(await within(await screen.findByRole("main")).findByText("Live session")).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/${slug}/global`)
  })

  test("opens resizable preview and tree panels from the titlebar", async () => {
    const user = userEvent.setup()
    renderApp(`/${slug}/global/session/ses_live`)

    expect(await screen.findByRole("heading", { name: "Live session" })).toBeInTheDocument()
    const serverButton = screen.getByRole("button", { name: /Manage servers/ })
    const toggle = screen.getByRole("button", { name: "Toggle file tree" })
    expect(serverButton.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await user.click(toggle)
    const tree = await screen.findByRole("complementary", { name: "File tree" })
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    const treeResize = screen.getByRole("separator", { name: "Resize file tree" })
    const treeWidth = Number(treeResize.getAttribute("aria-valuenow"))
    fireEvent.keyDown(treeResize, { key: "ArrowLeft" })
    expect(treeResize).toHaveAttribute("aria-valuenow", String(treeWidth + 10))

    await user.click(within(tree).getByRole("button", { name: "README.md" }))
    const preview = await screen.findByRole("complementary", { name: "File preview" })
    expect(preview.compareDocumentPosition(tree) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const previewResize = screen.getByRole("separator", { name: "Resize file preview" })
    const previewWidth = Number(previewResize.getAttribute("aria-valuenow"))
    fireEvent.keyDown(previewResize, { key: "ArrowRight" })
    expect(previewResize).toHaveAttribute("aria-valuenow", String(previewWidth - 10))
    expect(await within(preview).findByText("# Repo")).toBeInTheDocument()

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 600 })
    fireEvent.resize(window)
    expect(treeResize).toHaveAttribute("aria-valuenow", "180")
    expect(previewResize).toHaveAttribute("aria-valuenow", "180")

    await user.type(within(tree).getByRole("textbox", { name: "Find in project" }), "read")
    expect(within(tree).queryByRole("button", { name: "README.md" })).not.toBeInTheDocument()
    expect(await within(tree).findByRole("button", { name: "README.md" })).toBeInTheDocument()

    await user.click(within(preview).getByRole("button", { name: "Close file preview" }))
    expect(screen.queryByRole("complementary", { name: "File preview" })).not.toBeInTheDocument()
    await user.click(toggle)
    expect(screen.queryByRole("complementary", { name: "File tree" })).not.toBeInTheDocument()
  })

  test("renders registered servers from the real connection registry", async () => {
    renderApp(`/${slug}/settings/server-connections`)
    expect(await screen.findByText(origin)).toBeInTheDocument()
  })

  test("shows real agent and model options for a directory with no project yet", async () => {
    renderApp(`/${slug}/new/draft-1?directory=${encodeURIComponent("/tmp/brand-new-project")}`)

    expect(await screen.findByLabelText("Agent")).toHaveTextContent("build")
    expect(screen.getByLabelText("Model")).toHaveTextContent("GPT")
  })
})
