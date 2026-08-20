import { afterEach, describe, expect, test } from "bun:test"
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router"
import userEvent from "@testing-library/user-event"
import { ThemeProvider } from "@/components/theme-provider"
import { render, screen, within } from "@/test/test-utils"
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
    expect(screen.getByRole("button", { name: "Toggle menu" })).toBeInTheDocument()
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

  test("the settings route renders profile sections and closes back to the previous route", async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    const router = renderApp("/settings/general")

    expect(await screen.findByLabelText("Theme")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Close settings" }))
    expect(router.state.location.pathname).toBe("/")
  })
})
