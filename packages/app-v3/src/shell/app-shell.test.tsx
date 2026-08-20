import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { render } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { projects, sessions, MOCK_NOW } from "@/mock/fixtures"
import { mockMatchMedia } from "@/test/mock-match-media"
import { act, fireEvent, renderWithProviders, screen, waitFor, within } from "@/test/test-utils"
import { AppShell } from "./app-shell"

const originalMatchMedia = window.matchMedia
beforeEach(() => window.history.replaceState({}, ""))
afterEach(() => {
  window.matchMedia = originalMatchMedia
})

function noop() {}

const rail = {
  projects: projects.map((project) => ({ project, notification: { kind: "none" as const, working: false } })),
  selectedProject: projects[0],
  onSelectProject: noop,
  onAddProject: noop,
  onOpenSettings: noop,
}

const sidebarPanel = {
  project: projects[0],
  sessions: sessions.filter((session) => session.projectId === projects[0].id && !session.archived),
  now: MOCK_NOW,
  onSelectSession: noop,
  onArchiveSession: noop,
  onNewSession: noop,
  onRenameProject: noop,
  onClearNotifications: noop,
  onCloseProject: noop,
}

describe("AppShell", () => {
  test("renders without an ambient TooltipProvider", () => {
    mockMatchMedia(true)
    expect(() =>
      render(
        <AppShell rail={rail} sidebarPanel={sidebarPanel}>
          <div>Page content</div>
        </AppShell>,
      ),
    ).not.toThrow()
  })

  test("desktop renders the rail, expanded sessions panel, and one route viewport", () => {
    mockMatchMedia(true)
    renderWithProviders(
      <AppShell rail={rail} sidebarPanel={sidebarPanel}>
        <div>Page content</div>
      </AppShell>,
    )

    expect(screen.getByRole("navigation", { name: "Projects and sessions" })).toBeInTheDocument()
    expect(screen.getByRole("navigation", { name: "Sessions" })).toBeInTheDocument()
    expect(screen.getAllByText("Page content")).toHaveLength(1)
  })

  test("clicking the selected project collapses the sessions panel", async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    renderWithProviders(
      <AppShell rail={rail} sidebarPanel={sidebarPanel}>
        <div>Page content</div>
      </AppShell>,
    )

    const projectsNav = screen.getByRole("navigation", { name: "Projects" })
    await user.click(within(projectsNav).getByRole("button", { name: projects[0].name }))
    expect(screen.queryByRole("navigation", { name: "Sessions" })).not.toBeInTheDocument()
    expect(screen.getAllByText("Page content")).toHaveLength(1)
  })

  test("mobile menu opens a narrow navigation drawer and closes from the titlebar", async () => {
    mockMatchMedia(false)
    const user = userEvent.setup()
    renderWithProviders(
      <AppShell rail={rail} sidebarPanel={sidebarPanel}>
        <div>Page content</div>
      </AppShell>,
    )

    await user.click(screen.getByRole("button", { name: "Open menu" }))
    const drawer = screen.getByRole("navigation", { name: "Projects and sessions" })
    expect(drawer).toHaveClass("w-[calc(100%-2.5rem)]", "max-w-[400px]", "translate-x-0")
    expect(screen.getByRole("button", { name: "Close menu" })).toHaveAttribute("aria-controls", "mobile-navigation")
    await user.click(screen.getByRole("button", { name: "Close menu" }))
    expect(screen.queryByRole("navigation", { name: "Projects and sessions" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open menu" })).toHaveFocus()
    expect(screen.getAllByText("Page content")).toHaveLength(1)
  })

  test("Mod+B focuses mobile navigation and Escape restores trigger focus", async () => {
    mockMatchMedia(false)
    renderWithProviders(
      <AppShell rail={rail} sidebarPanel={sidebarPanel}>
        <div>Page content</div>
      </AppShell>,
    )

    fireEvent.keyDown(window, { key: "b", metaKey: true })
    const drawer = screen.getByRole("navigation", { name: "Projects and sessions" })
    await waitFor(() => expect(drawer).toHaveFocus())
    expect(screen.getByRole("main").hasAttribute("inert")).toBe(true)
    fireEvent.keyDown(drawer, { key: "Tab", shiftKey: true })
    fireEvent.keyDown(document.activeElement!, { key: "Tab" })
    expect(screen.getByRole("button", { name: "Close menu" })).toHaveFocus()
    fireEvent.keyDown(window, { key: "Escape" })

    expect(screen.queryByRole("navigation", { name: "Projects and sessions" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open menu" })).toHaveFocus()
  })

  test("backdrop and routed rail actions close mobile navigation", async () => {
    mockMatchMedia(false)
    const user = userEvent.setup()
    const calls: string[] = []
    renderWithProviders(
      <AppShell rail={{ ...rail, onOpenSettings: () => calls.push("settings") }} sidebarPanel={sidebarPanel}>
        <div>Page content</div>
      </AppShell>,
    )

    await user.click(screen.getByRole("button", { name: "Open menu" }))
    await user.click(screen.getByRole("button", { name: "Close navigation" }))
    expect(screen.queryByRole("navigation", { name: "Projects and sessions" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open menu" })).toHaveFocus()

    await user.click(screen.getByRole("button", { name: "Open menu" }))
    await user.click(
      within(screen.getByRole("navigation", { name: "Projects and sessions" })).getByLabelText("Settings"),
    )
    expect(calls).toEqual(["settings"])
    expect(screen.queryByRole("navigation", { name: "Projects and sessions" })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole("main")).toHaveFocus())
  })

  test("browser history navigation dismisses mobile navigation", async () => {
    mockMatchMedia(false)
    const user = userEvent.setup()
    renderWithProviders(
      <AppShell rail={rail} sidebarPanel={sidebarPanel}>
        <div>Page content</div>
      </AppShell>,
    )

    const path = window.location.pathname
    await user.click(screen.getByRole("button", { name: "Open menu" }))
    expect(window.history.state?.henaMobileNavigation).toBe(true)
    window.history.replaceState({}, "")
    fireEvent(window, new PopStateEvent("popstate", { state: {} }))

    expect(screen.queryByRole("navigation", { name: "Projects and sessions" })).not.toBeInTheDocument()
    expect(window.location.pathname).toBe(path)
    expect(screen.getByRole("button", { name: "Open menu" })).toHaveFocus()

    fireEvent(window, new PopStateEvent("popstate", { state: { henaMobileNavigation: true } }))
    expect(screen.getByRole("navigation", { name: "Projects and sessions" })).toBeInTheDocument()
    expect(window.location.pathname).toBe(path)

    fireEvent(window, new PopStateEvent("popstate", { state: {} }))
    expect(screen.queryByRole("navigation", { name: "Projects and sessions" })).not.toBeInTheDocument()
  })

  test("restores an open drawer from history state with focus contained", async () => {
    mockMatchMedia(false)
    window.history.replaceState({ henaMobileNavigation: true }, "")
    renderWithProviders(
      <AppShell rail={rail} sidebarPanel={sidebarPanel}>
        <div>Page content</div>
      </AppShell>,
    )

    await waitFor(() => expect(screen.getByRole("navigation", { name: "Projects and sessions" })).toHaveFocus())
    expect(screen.getByRole("main").hasAttribute("inert")).toBe(true)
  })

  test("entering the desktop breakpoint clears mobile navigation state", async () => {
    const viewport = mockMatchMedia(false)
    const user = userEvent.setup()
    renderWithProviders(
      <AppShell rail={rail} sidebarPanel={sidebarPanel}>
        <div>Page content</div>
      </AppShell>,
    )

    await user.click(screen.getByRole("button", { name: "Open menu" }))
    act(() => viewport.change(true))

    await waitFor(() => expect(document.getElementById("mobile-navigation")).toHaveAttribute("aria-hidden", "true"))
    expect(window.history.state?.henaMobileNavigation).not.toBe(true)
    expect(screen.getByRole("main")).not.toHaveAttribute("inert")
  })
})
