import { afterEach, describe, expect, test } from "bun:test"
import { render as rtlRender } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { projects, sessions, MOCK_NOW } from "@/mock/fixtures"
import { mockMatchMedia } from "@/test/mock-match-media"
import { render, screen, within } from "@/test/test-utils"
import { AppShell } from "./app-shell"

const originalMatchMedia = window.matchMedia
afterEach(() => {
  window.matchMedia = originalMatchMedia
})

function noop() {}

const rail = {
  projects,
  selectedProjectId: projects[0].id,
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
      rtlRender(
        <AppShell rail={rail} sidebarPanel={sidebarPanel}>
          <div>Page content</div>
        </AppShell>,
      ),
    ).not.toThrow()
  })

  test("desktop renders the rail, expanded sessions panel, and one route viewport", () => {
    mockMatchMedia(true)
    render(
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
    render(
      <AppShell rail={rail} sidebarPanel={sidebarPanel}>
        <div>Page content</div>
      </AppShell>,
    )

    const projectsNav = screen.getByRole("navigation", { name: "Projects" })
    await user.click(within(projectsNav).getByRole("button", { name: projects[0].name }))
    expect(screen.queryByRole("navigation", { name: "Sessions" })).not.toBeInTheDocument()
    expect(screen.getAllByText("Page content")).toHaveLength(1)
  })

  test("mobile hamburger opens the 400px navigation drawer", async () => {
    mockMatchMedia(false)
    const user = userEvent.setup()
    render(
      <AppShell rail={rail} sidebarPanel={sidebarPanel}>
        <div>Page content</div>
      </AppShell>,
    )

    await user.click(screen.getByRole("button", { name: "Toggle menu" }))
    const drawer = screen.getByRole("navigation", { name: "Projects and sessions" })
    expect(drawer).toHaveClass("max-w-[400px]", "translate-x-0")
    expect(screen.getAllByText("Page content")).toHaveLength(1)
  })
})
