import { afterEach, describe, expect, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router"
import userEvent from "@testing-library/user-event"
import { ThemeProvider } from "@/components/theme-provider"
import { ConnectionProvider } from "@/connection/provider"
import { encodeServerSlug } from "@/lib/server-url"
import { mockMatchMedia } from "@/test/mock-match-media"
import { fireEvent, render, screen, within } from "@/test/test-utils"
import { routeTree } from "./routeTree.gen"

const origin = "http://localhost:4096"
const slug = encodeServerSlug(origin)
afterEach(() => {
  localStorage.removeItem("hena.connections.v1")
  localStorage.removeItem("hena.tombstones.v1")
})

function renderApp(initialPath: string, fetcher = collectionFetcher()) {
  mockMatchMedia(true)
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
  const repoLocationKey = JSON.stringify({ directory: "/repo" })
  const liveSession = {
    id: "ses_live",
    projectID: "global",
    title: "Live session",
    location: { directory: "/repo" },
    working: false,
    time: { created: 1, updated: 1 },
  }
  const collections: Record<string, Map<string, StoredRow>> = {
    projects: new Map([["global", { key: "global", revision: "1", row: repoProject }]]),
    locations: new Map([[repoLocationKey, { key: repoLocationKey, revision: "1", row: { directory: "/repo" } }]]),
    sessions: new Map([["ses_live", { key: "ses_live", revision: "1", row: liveSession }]]),
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
} = {}) {
  const database = collectionDatabase()
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const path = new URL(request.url).pathname
    if (path === "/api/collection/capabilities")
      return Response.json({ feedId: "feed", protocol: { min: 1, max: 1 }, auth: "none" })
    if (path === "/api/collection/streams" && request.method === "POST")
      return Response.json({ streamId: "stream", generation: 1, expiresAt: Date.now() + 300_000, feed: { feedId: "feed", runtimeId: "runtime", retainedFloor: 0 }, subscriptionRevision: 0 })
    if (path === "/api/collection/streams/stream/subscription")
      return Response.json({ generation: 1, revision: 1 })
    if (path === "/api/collection/streams/stream/events") return eventResponse(request.signal, database)
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
    if (path === "/api/fs/read") return Response.json({ text: "# Repo", totalBytes: 6 })
    if (path === "/api/session" && request.method === "POST" && options.onCreateSession)
      return options.onCreateSession(request, (changes) => database.push(changes))
    return Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 })
  }
}

function eventResponse(signal: AbortSignal, database: ReturnType<typeof collectionDatabase>) {
  const scopeNames = ["projects", "locations", "sessions", "permissions", "questions"]
  const common = { protocolVersion: 1, feedId: "feed", runtimeId: "runtime", streamId: "stream", generation: 1, subscriptionRevision: 1 }
  const frames = scopeNames.flatMap((collection, index) => {
    const rows = database.snapshot(collection)
    const scope = { collection, scopeKey: "" }
    const snapshotId = `snapshot-${index}`
    return [
      { ...common, type: "snapshot.begin", snapshotId, baseSeq: 0, replace: true, scope },
      { ...common, type: "snapshot.page", snapshotId, scope, rows },
      { ...common, type: "snapshot.end", snapshotId, scope, keyCount: rows.length, throughSeq: 0 },
    ]
  })
  return new Response(new ReadableStream({
    start(controller) {
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
