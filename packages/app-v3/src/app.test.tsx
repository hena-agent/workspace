import { afterEach, describe, expect, test } from "bun:test"
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router"
import userEvent from "@testing-library/user-event"
import { ThemeProvider } from "@/components/theme-provider"
import { MockServerProvider } from "@/features/server/mock-server-provider"
import { encodeServerSlug } from "@/lib/server-url"
import type { Connection } from "@/lib/types"
import { connections } from "@/mock/fixtures"
import { mockMatchMedia } from "@/test/mock-match-media"
import { act, render, screen, waitFor, within } from "@/test/test-utils"
import { routeTree } from "./routeTree.gen"

const originalMatchMedia = window.matchMedia
const originalHistoryBack = window.history.back.bind(window.history)
const LOCAL_SLUG = encodeServerSlug("http://localhost:4096")
const STAGING_SLUG = encodeServerSlug("https://staging.hena.dev")

afterEach(() => {
  window.matchMedia = originalMatchMedia
  window.history.back = originalHistoryBack
  window.history.replaceState(null, "", "/")
  localStorage.removeItem("theme")
  localStorage.removeItem("density")
  localStorage.removeItem("font-size")
  localStorage.removeItem("reduced-motion")
  delete document.documentElement.dataset.density
  delete document.documentElement.dataset.fontSize
  delete document.documentElement.dataset.reducedMotion
  document.documentElement.classList.remove("light", "dark")
})

function renderApp(
  initialPath: string,
  initialConnections?: Connection[],
  pageOrigin = "http://localhost:4096",
) {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialPath] }) })
  render(
    <ThemeProvider>
      <MockServerProvider initialConnections={initialConnections} pageOrigin={pageOrigin}>
        <RouterProvider router={router} />
      </MockServerProvider>
    </ThemeProvider>,
  )
  return router
}

describe("app routing (real routeTree, memory history)", () => {
  test("/ redirects to the default server slug", async () => {
    mockMatchMedia(false)
    const router = renderApp("/")

    expect(await screen.findByRole("heading", { name: "Recent projects" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Manage servers. Current server: Local" })).toHaveTextContent("Local")
    expect(router.state.location.pathname).toBe(`/${LOCAL_SLUG}`)
  })

  test("seeded connections obey the current origin transport rules", async () => {
    mockMatchMedia(true)
    const router = renderApp("/", undefined, "https://app.hena.dev")

    expect(await screen.findByRole("heading", { name: "Recent projects" })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/${STAGING_SLUG}`)
    expect(screen.getByRole("button", { name: "Manage servers. Current server: staging.hena.dev" })).toHaveTextContent(
      "staging.hena.dev",
    )
  })

  test("an unknown route inside a project falls back rather than crashing the shell", async () => {
    mockMatchMedia(true)
    renderApp(`/${LOCAL_SLUG}/proj-hena`)

    expect(
      within(await screen.findByRole("navigation", { name: "Projects" })).getByRole("button", { name: /^hena(?:,|$)/ }),
    ).toHaveAttribute("aria-pressed", "true")
  })

  test("registering a server from a fresh profile resumes its deep link", async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    const initialPath = `/${LOCAL_SLUG}/proj-hena/session/sess-transcript`
    const router = renderApp(initialPath, [], "http://localhost:4096")

    expect(await screen.findByText("Session not found.")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /^Manage servers/ }))
    expect(screen.getByLabelText("Add a mock server")).toHaveValue("http://localhost:4096")
    await user.click(screen.getByRole("button", { name: "Add server" }))

    expect(router.state.location.pathname).toBe(initialPath)
    expect(await screen.findByRole("heading", { name: "Wire the collection stream protocol" })).toBeInTheDocument()
  })

  test("a hosted profile rejects loopback HTTP registration", async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    renderApp(`/${LOCAL_SLUG}`, [], "https://app.hena.dev")

    expect(await screen.findByText("Server not found.")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /^Manage servers/ }))
    await user.click(screen.getByRole("button", { name: "Add server" }))

    expect(screen.getByText("Enter an HTTP or HTTPS server URL allowed from this origin.")).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Recent projects" })).not.toBeInTheDocument()
  })

  test("navigating rail -> session list -> transcript updates the URL and content", async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    const router = renderApp("/")

    const projectRail = await screen.findByRole("navigation", { name: "Projects" })
    await user.click(within(projectRail).getByRole("button", { name: /^hena(?:,|$)/ }))
    expect(router.state.location.pathname).toBe(`/${LOCAL_SLUG}/proj-hena`)
    expect(
      within(await screen.findByRole("navigation", { name: "Projects" })).getByRole("button", { name: /^hena(?:,|$)/ }),
    ).toHaveAttribute("aria-pressed", "true")

    const sessionList = await screen.findByRole("navigation", { name: "Sessions" })
    await user.click(within(sessionList).getByRole("button", { name: /Wire the collection stream protocol/ }))

    expect(router.state.location.pathname).toMatch(new RegExp(`^/${LOCAL_SLUG}/proj-hena/session/`))
    expect(await screen.findByRole("log", { name: "Messages" })).toBeInTheDocument()
    expect(screen.getByLabelText("Message")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Wire the collection stream protocol" })).toBeInTheDocument()
  })

  test("the mobile project root is the session list and selecting a session pushes detail", async () => {
    mockMatchMedia(false)
    const user = userEvent.setup()
    const router = renderApp(`/${LOCAL_SLUG}/proj-hena`)

    const sessionList = await screen.findByRole("navigation", { name: "Sessions" })
    await user.click(within(sessionList).getByRole("button", { name: /Wire the collection stream protocol/ }))

    expect(router.state.location.pathname).toBe(`/${LOCAL_SLUG}/proj-hena/session/sess-transcript`)
    expect(await screen.findByRole("log", { name: "Messages" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Wire the collection stream protocol" })).toHaveFocus()
    await act(async () => {
      router.history.back()
      await router.load()
    })
    expect(router.state.location.pathname).toBe(`/${LOCAL_SLUG}/proj-hena`)
    expect(
      within(await screen.findByRole("navigation", { name: "Sessions" })).getByRole("button", {
        name: /Wire the collection stream protocol/,
      }),
    ).toHaveFocus()
  })

  test("file selection is restored from URL search and recorded in history", async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    const firstPath = "packages/hena/src/server/collection/changelog.ts"
    const nextPath = "packages/hena/src/server/collection/snapshot.ts"
    const router = renderApp(
      `/${LOCAL_SLUG}/proj-hena/session/sess-transcript/files?file=${encodeURIComponent(firstPath)}`,
    )

    expect(await screen.findByText(firstPath)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "snapshot.ts" }))
    expect(router.state.location.search.file).toBe(nextPath)
    expect(await screen.findByText(nextPath)).toBeInTheDocument()
    await act(async () => {
      router.history.back()
      await router.load()
    })
    expect(router.state.location.search.file).toBe(firstPath)
    expect(await screen.findByText(firstPath)).toBeInTheDocument()
  })

  test("review selection is restored from URL search", async () => {
    mockMatchMedia(true)
    const selectedPath = "packages/hena/src/server/collection/snapshot.ts"
    const router = renderApp(
      `/${LOCAL_SLUG}/proj-hena/session/sess-transcript/review?file=${encodeURIComponent(selectedPath)}`,
    )

    expect((await screen.findAllByText(selectedPath)).length).toBeGreaterThan(0)
    expect(router.state.location.search.file).toBe(selectedPath)
  })

  test("Mod+K opens the command palette and selecting a project navigates to it", async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    const router = renderApp("/")

    await screen.findByRole("heading", { name: "Recent projects" })
    await user.keyboard("{Meta>}k{/Meta}")
    await user.click(within(await screen.findByRole("dialog")).getByText("hena"))

    expect(router.state.location.pathname).toBe(`/${LOCAL_SLUG}/proj-hena`)
  })

  test("command-palette navigation closes an open mobile drawer before navigating", async () => {
    mockMatchMedia(false)
    window.history.back = () => {
      window.history.replaceState({}, "")
      window.dispatchEvent(new PopStateEvent("popstate", { state: {} }))
    }
    const user = userEvent.setup()
    const router = renderApp(`/${LOCAL_SLUG}/proj-hena`)

    await user.click(await screen.findByRole("button", { name: "Open menu" }))
    await user.keyboard("{Meta>}k{/Meta}")
    await user.click(within(await screen.findByRole("dialog")).getByText("marketing-site"))

    expect(router.state.location.pathname).toBe(`/${LOCAL_SLUG}/proj-marketing`)
    expect(window.history.state?.henaMobileNavigation).not.toBe(true)
    expect(screen.queryByRole("navigation", { name: "Projects and sessions" })).not.toBeInTheDocument()
  })

  test("appearance settings apply density, font size, motion, and browser chrome color", async () => {
    const media = mockMatchMedia(false)
    const themeColor = document.createElement("meta")
    themeColor.name = "theme-color"
    document.head.appendChild(themeColor)
    const user = userEvent.setup()
    renderApp(`/${LOCAL_SLUG}/settings/general`)

    await waitFor(() => expect(themeColor).toHaveAttribute("content", "#fafafa"))
    act(() => media.change(true))
    await waitFor(() => expect(themeColor).toHaveAttribute("content", "#080808"))
    expect(document.documentElement).toHaveClass("dark")

    await user.click(await screen.findByLabelText("Theme"))
    await user.click(screen.getByRole("option", { name: "Light" }))
    await waitFor(() => expect(themeColor).toHaveAttribute("content", "#fafafa"))
    expect(document.documentElement).toHaveClass("light")

    await user.click(screen.getByLabelText("Density"))
    await user.click(screen.getByRole("option", { name: "Comfortable" }))
    expect(document.documentElement).toHaveAttribute("data-density", "comfortable")

    await user.click(screen.getByRole("button", { name: "Appearance" }))
    await user.click(screen.getByLabelText("Font size"))
    await user.click(screen.getByRole("option", { name: "Large" }))
    await user.click(screen.getByRole("switch", { name: "Reduce motion" }))

    expect(document.documentElement).toHaveAttribute("data-font-size", "large")
    expect(document.documentElement).toHaveAttribute("data-reduced-motion", "true")
    expect(localStorage.getItem("font-size")).toBe("large")
    expect(localStorage.getItem("reduced-motion")).toBe("true")
    themeColor.remove()
  })

  test("the project rail only shows projects from the current server", async () => {
    mockMatchMedia(true)
    renderApp(`/${LOCAL_SLUG}/proj-hena`)

    const projectRail = await screen.findByRole("navigation", { name: "Projects" })
    expect(within(projectRail).getByRole("button", { name: /^hena(?:,|$)/ })).toBeInTheDocument()
    expect(within(projectRail).queryByRole("button", { name: /^docs(?:,|$)/ })).not.toBeInTheDocument()
  })

  test("session routes reject mismatched project and connection ownership", async () => {
    mockMatchMedia(true)
    renderApp(`/${STAGING_SLUG}/proj-hena/session/sess-transcript`)

    expect(await screen.findByText("Session not found.")).toBeInTheDocument()
    expect(screen.queryByRole("log", { name: "Messages" })).not.toBeInTheDocument()
  })

  test("review routes reject mismatched session ownership", async () => {
    mockMatchMedia(true)
    renderApp(`/${LOCAL_SLUG}/proj-marketing/session/sess-transcript/review`)

    expect(await screen.findByText("Session not found.")).toBeInTheDocument()
    expect(screen.queryByText("src/collection/sync.ts")).not.toBeInTheDocument()
  })

  test("file routes reject mismatched session ownership", async () => {
    mockMatchMedia(true)
    renderApp(`/${LOCAL_SLUG}/proj-marketing/session/sess-transcript/files`)

    expect(await screen.findByText("Session not found.")).toBeInTheDocument()
    expect(screen.queryByText("src")).not.toBeInTheDocument()
  })

  test("switching sessions clears route-owned composer state", async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    const router = renderApp(`/${LOCAL_SLUG}/proj-hena/session/sess-transcript`)

    const composer = await screen.findByLabelText("Message")
    await user.type(composer, "unsent draft")
    await user.click(
      within(screen.getByRole("navigation", { name: "Sessions" })).getByRole("button", {
        name: /Rotate the OAuth client secret/,
      }),
    )

    expect(router.state.location.pathname).toBe(`/${LOCAL_SLUG}/proj-hena/session/sess-permission`)
    expect(await screen.findByRole("heading", { name: "Rotate the OAuth client secret" })).toBeInTheDocument()
    expect(screen.getByLabelText("Message")).toHaveValue("")
  })

  test("changing a session owner tuple remounts route-owned state", async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    const router = renderApp(`/${LOCAL_SLUG}/proj-hena/session/sess-transcript`)

    await user.type(await screen.findByLabelText("Message"), "owner-scoped draft")
    await act(() =>
      router.navigate({
        to: "/$connectionId/$projectId/session/$sessionId",
        params: { connectionId: STAGING_SLUG, projectId: "proj-hena", sessionId: "sess-transcript" },
      }),
    )
    expect(await screen.findByText("Session not found.")).toBeInTheDocument()
    await act(() =>
      router.navigate({
        to: "/$connectionId/$projectId/session/$sessionId",
        params: { connectionId: LOCAL_SLUG, projectId: "proj-hena", sessionId: "sess-transcript" },
      }),
    )

    expect(await screen.findByLabelText("Message")).toHaveValue("")
  })

  test("new draft ids do not collide with a deep-linked draft after reload", async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    const initialPath = `/${LOCAL_SLUG}/proj-hena/new/draft-1`
    const router = renderApp(initialPath)

    await user.type(await screen.findByLabelText("Message"), "old draft")
    await user.click(screen.getByRole("button", { name: "New session" }))

    expect(router.state.location.pathname).not.toBe(initialPath)
    expect(await screen.findByLabelText("Message")).toHaveValue("")
  })

  test("a direct settings entry closes to the current server home", async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    const router = renderApp(`/${LOCAL_SLUG}/settings/general`)

    expect(await screen.findByLabelText("Theme")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Close settings" }))
    expect(router.state.location.pathname).toBe(`/${LOCAL_SLUG}`)
    await act(async () => {
      router.history.back()
      await router.load()
    })
    expect(router.state.location.pathname).toBe(`/${LOCAL_SLUG}`)
  })

  test("the settings index redirects to general settings", async () => {
    mockMatchMedia(true)
    const router = renderApp(`/${LOCAL_SLUG}/settings`)

    expect(await screen.findByLabelText("Theme")).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/${LOCAL_SLUG}/settings/general`)
  })

  test("settings sections close back to the route that opened them", async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    const router = renderApp(`/${LOCAL_SLUG}/proj-hena/session/sess-transcript`)

    await screen.findByRole("heading", { name: "Wire the collection stream protocol" })
    await user.click(screen.getByRole("button", { name: "Settings" }))
    await user.click(await screen.findByRole("button", { name: "Appearance" }))
    await user.click(screen.getByRole("button", { name: "Close settings" }))

    expect(router.state.location.pathname).toBe(`/${LOCAL_SLUG}/proj-hena/session/sess-transcript`)
  })

  test("server settings reject unknown connections", async () => {
    mockMatchMedia(true)
    renderApp(`/${encodeServerSlug("https://does-not-exist.example")}/settings/providers`)

    expect(await screen.findByText("Connection not found.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Providers" })).not.toBeInTheDocument()
  })

  test("changing the settings connection resets server-owned state", async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    const router = renderApp(`/${LOCAL_SLUG}/settings/providers`)

    await user.click(await screen.findByRole("button", { name: "Disconnect Anthropic" }))
    expect(screen.getByRole("button", { name: "Connect Anthropic" })).toBeInTheDocument()
    await act(() =>
      router.navigate({
        to: "/$connectionId/settings/$section",
        params: { connectionId: STAGING_SLUG, section: "providers" },
      }),
    )

    expect(await screen.findByRole("button", { name: "Disconnect Anthropic" })).toBeInTheDocument()
  })

  test("storage settings are scoped to the route server", async () => {
    mockMatchMedia(true)
    const router = renderApp(`/${LOCAL_SLUG}/settings/storage`)

    expect(await screen.findByText("18 MiB of 50 MiB")).toBeInTheDocument()
    await act(() =>
      router.navigate({
        to: "/$connectionId/settings/$section",
        params: { connectionId: STAGING_SLUG, section: "storage" },
      }),
    )

    expect(await screen.findByText("7 MiB of 50 MiB")).toBeInTheDocument()
    expect(screen.queryByText("18 MiB of 50 MiB")).not.toBeInTheDocument()
  })

  test("selecting a server updates the URL slug", async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    const router = renderApp(`/${LOCAL_SLUG}`)

    await user.click(await screen.findByRole("button", { name: /^Manage servers/ }))
    const dialog = await screen.findByRole("dialog", { name: "Servers" })
    await user.click(within(dialog).getByRole("button", { name: /staging\.hena\.dev/ }))

    expect(router.state.location.pathname).toBe(`/${STAGING_SLUG}`)
  })

  test("offline servers remain visible but cannot be selected", async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    const router = renderApp(
      `/${LOCAL_SLUG}`,
      connections.map((connection) =>
        connection.id === "conn-staging" ? { ...connection, status: "offline" } : connection,
      ),
    )

    await user.click(await screen.findByRole("button", { name: /^Manage servers/ }))
    const dialog = await screen.findByRole("dialog", { name: "Servers" })
    const offline = within(dialog).getByRole("button", { name: /staging\.hena\.dev/ })

    expect(offline).toBeDisabled()
    await user.click(offline)
    expect(router.state.location.pathname).toBe(`/${LOCAL_SLUG}`)
    expect(dialog).toBeInTheDocument()
  })

  test("the titlebar reports the worst registered server status", async () => {
    mockMatchMedia(true)
    renderApp(`/${LOCAL_SLUG}`)

    expect(await screen.findByTitle("Connecting")).toBeInTheDocument()
  })

  test("adding a mock server routes to its URL slug", async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    const router = renderApp(`/${LOCAL_SLUG}`)

    await user.click(await screen.findByRole("button", { name: /^Manage servers/ }))
    await user.type(screen.getByLabelText("Add a mock server"), "box.example.com")
    await user.click(screen.getByRole("button", { name: "Add server" }))

    expect(router.state.location.pathname).toBe(`/${encodeServerSlug("https://box.example.com")}`)
  })
})
