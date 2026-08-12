import { describe, expect, test } from "bun:test"
import { render, screen, within } from "@/test/test-utils"
import { MobileNavDrawer } from "./mobile-nav-drawer"
import { projects, sessions, MOCK_NOW } from "@/mock/fixtures"

const project = projects[0]
const projectSessions = sessions.filter((s) => s.projectId === project.id && !s.archived)
function noop() {}

describe("MobileNavDrawer", () => {
  test("renders nothing when closed", () => {
    render(
      <MobileNavDrawer
        open={false}
        onOpenChange={noop}
        rail={{ projects, onSelectProject: noop, onAddProject: noop, onOpenSettings: noop, onOpenHelp: noop }}
        sidebarPanel={{
          project,
          sessions: projectSessions,
          now: MOCK_NOW,
          onSelectSession: noop,
          onArchiveSession: noop,
          onNewSession: noop,
          onRenameProject: noop,
          onClearNotifications: noop,
          onCloseProject: noop,
        }}
      />,
    )
    expect(screen.queryByText(project.name)).not.toBeInTheDocument()
  })

  test("renders the rail and session list when open", () => {
    render(
      <MobileNavDrawer
        open
        onOpenChange={noop}
        rail={{ projects, onSelectProject: noop, onAddProject: noop, onOpenSettings: noop, onOpenHelp: noop }}
        sidebarPanel={{
          project,
          sessions: projectSessions,
          now: MOCK_NOW,
          onSelectSession: noop,
          onArchiveSession: noop,
          onNewSession: noop,
          onRenameProject: noop,
          onClearNotifications: noop,
          onCloseProject: noop,
        }}
      />,
    )
    expect(
      within(screen.getByRole("navigation", { name: "Projects" })).getByRole("button", { name: project.name }),
    ).toBeInTheDocument()
    expect(screen.getByText(projectSessions[0].title)).toBeInTheDocument()
  })
})
