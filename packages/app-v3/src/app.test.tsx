import { afterEach, describe, expect, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router"
import userEvent from "@testing-library/user-event"
import { ThemeProvider } from "@/components/theme-provider"
import { ConnectionProvider } from "@/connection/provider"
import { markSessionSeen } from "@/local-state/seen"
import { encodeServerSlug } from "@/lib/server-url"
import { mockMatchMedia } from "@/test/mock-match-media"
import { fireEvent, render, screen, waitFor, within } from "@/test/test-utils"
import { routeTree } from "./routeTree.gen"

const origin = "http://localhost:4096"
const slug = encodeServerSlug(origin)
const originalInnerWidth = window.innerWidth
afterEach(() => {
  localStorage.removeItem("hena.connections.v1")
  localStorage.removeItem("hena.tombstones.v1")
  localStorage.removeItem(`hena.seen.v1.${slug}`)
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
function collectionDatabase() {
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
} = {}) {
  const database = collectionDatabase()
  let subscribedSessions: string[] = []
  let subscriptionRevision = 0
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

  test("restores the last session when opening a recent project", async () => {
    const user = userEvent.setup()
    markSessionSeen(origin, "ses_live", 1)
    const router = renderApp(`/${slug}`)

    await user.click(await screen.findByRole("button", { name: /\/repo/ }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/${slug}/global/session/ses_live`))
    expect(screen.getByRole("heading", { name: "Live session" })).toBeInTheDocument()
  })

  test("falls back to the project overview when session history is stale", async () => {
    markSessionSeen(origin, "ses_missing", 1)
    const router = renderApp(`/${slug}/global`)

    expect(await screen.findByRole("heading", { name: "Repo" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/${slug}/global`)
  })

  test("keeps the project session list on mobile", async () => {
    markSessionSeen(origin, "ses_live", 1)
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
