import { afterEach, describe, expect, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router"
import userEvent from "@testing-library/user-event"
import { ThemeProvider } from "@/components/theme-provider"
import { ConnectionProvider } from "@/connection/provider"
import { encodeServerSlug } from "@/lib/server-url"
import { mockMatchMedia } from "@/test/mock-match-media"
import { render, screen } from "@/test/test-utils"
import { routeTree } from "./routeTree.gen"

const origin = "http://localhost:4096"
const slug = encodeServerSlug(origin)
afterEach(() => {
  localStorage.removeItem("hena.connections.v1")
  localStorage.removeItem("hena.tombstones.v1")
})

function renderApp(initialPath: string) {
  mockMatchMedia(true)
  const fetcher = collectionFetcher()
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

function collectionFetcher() {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const path = new URL(request.url).pathname
    if (path === "/api/collection/capabilities")
      return Response.json({ feedId: "feed", protocol: { min: 1, max: 1 }, auth: "none" })
    if (path === "/api/collection/streams" && request.method === "POST")
      return Response.json({ streamId: "stream", generation: 1, expiresAt: Date.now() + 300_000, feed: { feedId: "feed", runtimeId: "runtime", retainedFloor: 0 }, subscriptionRevision: 0 })
    if (path === "/api/collection/streams/stream/subscription")
      return Response.json({ generation: 1, revision: 1 })
    if (path === "/api/collection/streams/stream/events") return eventResponse(request.signal)
    return Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 })
  }
}

function eventResponse(signal: AbortSignal) {
  const scopes = [
    { collection: "projects", scopeKey: "", rows: [{ key: "global", revision: "1", row: { id: "global", worktree: "/repo", name: "Repo", time: { created: 1, updated: 1 } } }] },
    { collection: "locations", scopeKey: "", rows: [{ key: JSON.stringify({ directory: "/repo" }), revision: "1", row: { directory: "/repo" } }] },
    { collection: "sessions", scopeKey: "", rows: [{ key: "ses_live", revision: "1", row: { id: "ses_live", projectID: "global", title: "Live session", location: { directory: "/repo" }, working: false, time: { created: 1, updated: 1 } } }] },
    { collection: "permissions", scopeKey: "", rows: [] },
    { collection: "questions", scopeKey: "", rows: [] },
  ]
  const common = { protocolVersion: 1, feedId: "feed", runtimeId: "runtime", streamId: "stream", generation: 1, subscriptionRevision: 1 }
  const frames = scopes.flatMap((scope, index) => [
    { ...common, type: "snapshot.begin", snapshotId: `snapshot-${index}`, baseSeq: 0, replace: true, scope: { collection: scope.collection, scopeKey: scope.scopeKey } },
    { ...common, type: "snapshot.page", snapshotId: `snapshot-${index}`, scope: { collection: scope.collection, scopeKey: scope.scopeKey }, rows: scope.rows },
    { ...common, type: "snapshot.end", snapshotId: `snapshot-${index}`, scope: { collection: scope.collection, scopeKey: scope.scopeKey }, keyCount: scope.rows.length, throughSeq: 0 },
  ])
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")))
      signal.addEventListener("abort", () => controller.close(), { once: true })
    },
  }), { headers: { "content-type": "text/event-stream" } })
}

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

  test("renders the explicit phase-two review state", async () => {
    renderApp(`/${slug}/global/session/ses_live/review`)
    expect(await screen.findByText("Review is not supported by this server yet.")).toBeInTheDocument()
  })

  test("renders registered servers from the real connection registry", async () => {
    renderApp(`/${slug}/settings/server-connections`)
    expect(await screen.findByText(origin)).toBeInTheDocument()
  })
})
