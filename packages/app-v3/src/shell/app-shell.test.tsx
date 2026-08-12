import { afterEach, describe, expect, test } from "bun:test"
import { render as rtlRender } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { render, screen, within } from "@/test/test-utils"
import { mockMatchMedia } from "@/test/mock-match-media"
import { AppShell } from "./app-shell"
import { projects, sessions, MOCK_NOW } from "@/mock/fixtures"

const originalMatchMedia = window.matchMedia
afterEach(() => {
  window.matchMedia = originalMatchMedia
})

const project = projects[0]
const projectSessions = sessions.filter((s) => s.projectId === project.id && !s.archived)
function noop() {}

const railProps = { projects, onSelectProject: noop, onAddProject: noop, onOpenSettings: noop, onOpenHelp: noop }
const sidebarPanelProps = {
  project,
  sessions: projectSessions,
  now: MOCK_NOW,
  onSelectSession: noop,
  onArchiveSession: noop,
  onNewSession: noop,
  onRenameProject: noop,
  onClearNotifications: noop,
  onCloseProject: noop,
}

describe("AppShell", () => {
  test("renders without an ambient TooltipProvider (it must own one itself)", () => {
    // Deliberately uses the raw testing-library render, not the project's
    // `@/test/test-utils` wrapper (which supplies TooltipProvider for every
    // other test in this suite). That wrapper is exactly what masked a real
    // bug: main.tsx never provided one, so Rail's tooltips crashed the real
    // app with "`Tooltip` must be used within `TooltipProvider`" even though
    // every wrapped test passed.
    mockMatchMedia(true)
    expect(() =>
      rtlRender(
        <AppShell rail={railProps} sidebarPanel={sidebarPanelProps} title="Inbox">
          <div>Page content</div>
        </AppShell>,
      ),
    ).not.toThrow()
  })

  test("on mobile, renders the page content without the persistent rail", () => {
    mockMatchMedia(false)
    render(
      <AppShell rail={railProps} sidebarPanel={sidebarPanelProps} title="Inbox">
        <div>Page content</div>
      </AppShell>,
    )

    expect(screen.getAllByText("Page content")).toHaveLength(1)
    expect(screen.queryByRole("navigation", { name: "Projects" })).not.toBeInTheDocument()
  })

  test("on desktop, renders exactly one copy of the page content alongside the rail and session list", () => {
    mockMatchMedia(true)
    render(
      <AppShell rail={railProps} sidebarPanel={sidebarPanelProps} title="Inbox">
        <div>Page content</div>
      </AppShell>,
    )

    expect(screen.getAllByText("Page content")).toHaveLength(1)
    expect(screen.getByRole("navigation", { name: "Projects" })).toBeInTheDocument()
    expect(screen.getByText(projectSessions[0].title)).toBeInTheDocument()
  })

  test("the hamburger opens the mobile nav drawer with the same project data", async () => {
    mockMatchMedia(false)
    const user = userEvent.setup()

    render(
      <AppShell rail={railProps} sidebarPanel={sidebarPanelProps} title="Inbox">
        <div>Page content</div>
      </AppShell>,
    )

    await user.click(screen.getByRole("button", { name: "Open menu" }))
    const drawerNav = await screen.findByRole("navigation", { name: "Projects" })
    expect(within(drawerNav).getByRole("button", { name: project.name })).toBeInTheDocument()
  })

  test("toggling the sidebar on desktop hides the session list but keeps the rail and page", async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()

    render(
      <AppShell rail={railProps} sidebarPanel={sidebarPanelProps} title="Inbox">
        <div>Page content</div>
      </AppShell>,
    )

    await user.click(screen.getByRole("button", { name: "Toggle sidebar" }))

    expect(screen.queryByText(projectSessions[0].title)).not.toBeInTheDocument()
    expect(screen.getByRole("navigation", { name: "Projects" })).toBeInTheDocument()
    expect(screen.getAllByText("Page content")).toHaveLength(1)
  })
})
