import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { SidebarPanel } from "./sidebar-panel"
import { projects, sessions, MOCK_NOW } from "@/mock/fixtures"

const project = projects[0]
const projectSessions = sessions.filter((s) => s.projectId === project.id && !s.archived)

function noop() {}

describe("SidebarPanel", () => {
  test("shows an empty state when no project is selected", () => {
    render(
      <SidebarPanel
        sessions={[]}
        now={MOCK_NOW}
        onSelectSession={noop}
        onArchiveSession={noop}
        onNewSession={noop}
        onRenameProject={noop}
        onClearNotifications={noop}
        onCloseProject={noop}
      />,
    )
    expect(screen.getByText("Select a project to see its sessions.")).toBeInTheDocument()
  })

  test("renders the project header, new-session button, and its sessions", () => {
    render(
      <SidebarPanel
        project={project}
        sessions={projectSessions}
        now={MOCK_NOW}
        onSelectSession={noop}
        onArchiveSession={noop}
        onNewSession={noop}
        onRenameProject={noop}
        onClearNotifications={noop}
        onCloseProject={noop}
      />,
    )
    expect(screen.getByText(project.name)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /New session/ })).toBeInTheDocument()
    expect(screen.getByText(projectSessions[0].title)).toBeInTheDocument()
  })

  test("the new-session button calls onNewSession", async () => {
    const user = userEvent.setup()
    let called = false

    render(
      <SidebarPanel
        project={project}
        sessions={projectSessions}
        now={MOCK_NOW}
        onSelectSession={noop}
        onArchiveSession={noop}
        onNewSession={() => (called = true)}
        onRenameProject={noop}
        onClearNotifications={noop}
        onCloseProject={noop}
      />,
    )

    await user.click(screen.getByRole("button", { name: /New session/ }))
    expect(called).toBe(true)
  })
})
