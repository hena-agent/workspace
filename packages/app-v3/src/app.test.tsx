import { afterEach, describe, expect, test } from "bun:test"
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router"
import userEvent from "@testing-library/user-event"
import { ThemeProvider } from "@/components/theme-provider"
import { act, render, screen, within } from "@/test/test-utils"
import { mockMatchMedia } from "@/test/mock-match-media"
import { routeTree } from "./routeTree.gen"

const originalMatchMedia = window.matchMedia
afterEach(() => {
  window.matchMedia = originalMatchMedia
})

function renderApp(initialPath: string) {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [initialPath] }) })
  render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  )
  return router
}

describe("app routing (real routeTree, memory history)", () => {
  test("/ renders the legacy Home inside the collapsed rail shell", async () => {
    mockMatchMedia(false)
    renderApp("/")
    expect(await screen.findByRole("heading", { name: "Recent projects" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open menu" })).toBeInTheDocument()
  })

  test("an unknown route inside a project falls back rather than crashing the shell", async () => {
    mockMatchMedia(true)
    renderApp("/conn-local/proj-hena")
    expect(
      within(await screen.findByRole("navigation", { name: "Projects" })).getByRole("button", { name: "hena" }),
    ).toHaveAttribute("aria-pressed", "true")
  })

  test("navigating rail -> session list -> transcript updates the URL and content", async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    const router = renderApp("/")

    const projectRail = await screen.findByRole("navigation", { name: "Projects" })
    await user.click(within(projectRail).getByRole("button", { name: "hena" }))
    expect(router.state.location.pathname).toBe("/conn-local/proj-hena")
    expect(
      within(await screen.findByRole("navigation", { name: "Projects" })).getByRole("button", { name: "hena" }),
    ).toHaveAttribute("aria-pressed", "true")

    const sessionList = await screen.findByRole("navigation", { name: "Sessions" })
    await user.click(within(sessionList).getByRole("button", { name: /Wire the collection stream protocol/ }))

    expect(router.state.location.pathname).toMatch(/^\/conn-local\/proj-hena\/session\//)
    expect(await screen.findByRole("log", { name: "Messages" })).toBeInTheDocument()
    expect(screen.getByLabelText("Message")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Wire the collection stream protocol" })).toBeInTheDocument()
  })

  test("Mod+K opens the command palette and selecting a project navigates to it", async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    const router = renderApp("/")

    await screen.findByRole("heading", { name: "Recent projects" })
    await user.keyboard("{Meta>}k{/Meta}")

    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByText("hena"))

    expect(router.state.location.pathname).toBe("/conn-local/proj-hena")
  })

  test("the project rail keeps projects from every connection visible", async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    const router = renderApp("/conn-local/proj-hena")

    const projectRail = await screen.findByRole("navigation", { name: "Projects" })
    expect(within(projectRail).getByRole("button", { name: "docs" })).toBeInTheDocument()
    await user.click(within(projectRail).getByRole("button", { name: "docs" }))

    expect(router.state.location.pathname).toBe("/conn-staging/proj-docs")
    expect(
      within(screen.getByRole("navigation", { name: "Projects" })).getByRole("button", { name: "docs" }),
    ).toHaveAttribute("aria-pressed", "true")
  })

  test("session routes reject mismatched project and connection ownership", async () => {
    mockMatchMedia(true)
    renderApp("/conn-staging/proj-hena/session/sess-transcript")

    expect(await screen.findByText("Session not found.")).toBeInTheDocument()
    expect(screen.queryByRole("log", { name: "Messages" })).not.toBeInTheDocument()
  })

  test("review routes reject mismatched session ownership", async () => {
    mockMatchMedia(true)
    renderApp("/conn-local/proj-marketing/session/sess-transcript/review")

    expect(await screen.findByText("Session not found.")).toBeInTheDocument()
    expect(screen.queryByText("src/collection/sync.ts")).not.toBeInTheDocument()
  })

  test("file routes reject mismatched session ownership", async () => {
    mockMatchMedia(true)
    renderApp("/conn-local/proj-marketing/session/sess-transcript/files")

    expect(await screen.findByText("Session not found.")).toBeInTheDocument()
    expect(screen.queryByText("src")).not.toBeInTheDocument()
  })

  test("switching sessions clears route-owned composer state", async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    const router = renderApp("/conn-local/proj-hena/session/sess-transcript")

    const composer = await screen.findByLabelText("Message")
    await user.type(composer, "unsent draft")
    await user.click(
      within(screen.getByRole("navigation", { name: "Sessions" })).getByRole("button", {
        name: /Rotate the OAuth client secret/,
      }),
    )

    expect(router.state.location.pathname).toBe("/conn-local/proj-hena/session/sess-permission")
    expect(await screen.findByRole("heading", { name: "Rotate the OAuth client secret" })).toBeInTheDocument()
    expect(screen.getByLabelText("Message")).toHaveValue("")
  })

  test("changing a session owner tuple remounts route-owned state", async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    const router = renderApp("/conn-local/proj-hena/session/sess-transcript")

    await user.type(await screen.findByLabelText("Message"), "owner-scoped draft")
    await act(() =>
      router.navigate({
        to: "/$connectionId/$projectId/session/$sessionId",
        params: { connectionId: "conn-staging", projectId: "proj-hena", sessionId: "sess-transcript" },
      }),
    )
    expect(await screen.findByText("Session not found.")).toBeInTheDocument()
    await act(() =>
      router.navigate({
        to: "/$connectionId/$projectId/session/$sessionId",
        params: { connectionId: "conn-local", projectId: "proj-hena", sessionId: "sess-transcript" },
      }),
    )

    expect(await screen.findByLabelText("Message")).toHaveValue("")
  })

  test("changing the draft id clears route-owned draft state", async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    const router = renderApp("/conn-local/proj-hena/new/draft-existing")

    await user.type(await screen.findByLabelText("Message"), "old draft")
    await user.click(screen.getByRole("button", { name: "New session" }))

    expect(router.state.location.pathname).not.toBe("/conn-local/proj-hena/new/draft-existing")
    expect(await screen.findByLabelText("Message")).toHaveValue("")
  })

  test("a direct settings entry closes to the home fallback", async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    const router = renderApp("/settings/general")

    expect(await screen.findByLabelText("Theme")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Close settings" }))
    expect(router.state.location.pathname).toBe("/")
    await act(async () => {
      router.history.back()
      await router.load()
    })
    expect(router.state.location.pathname).toBe("/")
  })

  test("settings sections close back to the route that opened them", async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    const router = renderApp("/conn-local/proj-hena/session/sess-transcript")

    await screen.findByRole("heading", { name: "Wire the collection stream protocol" })
    await user.click(screen.getByRole("button", { name: "Settings" }))
    await user.click(await screen.findByRole("button", { name: "Appearance" }))
    await user.click(screen.getByRole("button", { name: "Close settings" }))

    expect(router.state.location.pathname).toBe("/conn-local/proj-hena/session/sess-transcript")
  })

  test("server settings reject unknown connections", async () => {
    mockMatchMedia(true)
    renderApp("/settings/does-not-exist/providers")

    expect(await screen.findByText("Connection not found.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Providers" })).not.toBeInTheDocument()
  })

  test("changing the settings connection resets server-owned state", async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    const router = renderApp("/settings/conn-local/providers")

    await user.click(await screen.findByRole("button", { name: "Disconnect Anthropic" }))
    expect(screen.getByRole("button", { name: "Connect Anthropic" })).toBeInTheDocument()
    await act(() =>
      router.navigate({
        to: "/settings/$connectionId/$section",
        params: { connectionId: "conn-staging", section: "providers" },
      }),
    )

    expect(await screen.findByRole("button", { name: "Disconnect Anthropic" })).toBeInTheDocument()
  })
})
