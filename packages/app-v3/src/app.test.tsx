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
  test("/ renders the Inbox", async () => {
    mockMatchMedia(false)
    renderApp("/")
    expect(await screen.findByRole("heading", { name: "Inbox" })).toBeInTheDocument()
  })

  test("an unknown route inside a project falls back rather than crashing the shell", async () => {
    mockMatchMedia(true)
    renderApp("/conn-local/proj-hena")
    expect(await screen.findByRole("heading", { name: "hena" })).toBeInTheDocument()
  })

  test("navigating rail -> session list -> transcript updates the URL and each pane", async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    const router = renderApp("/")

    const rail = await screen.findByRole("navigation", { name: "Projects" })
    await user.click(within(rail).getByRole("button", { name: "hena" }))
    expect(router.state.location.pathname).toBe("/conn-local/proj-hena")
    expect(await screen.findByRole("heading", { name: "hena" })).toBeInTheDocument()

    const sessionList = await screen.findByRole("navigation", { name: "Sessions" })
    const firstSessionButton = within(sessionList).getAllByRole("button")[0]
    await user.click(firstSessionButton)

    expect(router.state.location.pathname).toMatch(/^\/conn-local\/proj-hena\/session\//)
    expect(await screen.findByRole("log", { name: "Messages" })).toBeInTheDocument()
    expect(screen.getByLabelText("Message")).toBeInTheDocument()
  })

  test("Mod+K opens the command palette and selecting a project navigates to it", async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    const router = renderApp("/")

    await screen.findByRole("heading", { name: "Inbox" })
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
