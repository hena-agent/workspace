import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { MOCK_NOW, projects, sessions } from "@/mock/fixtures"
import { render, screen } from "@/test/test-utils"
import { SidebarPanel } from "./sidebar-panel"

function noop() {}

function props(project: (typeof projects)[number]) {
  return {
    project,
    sessions: sessions.filter((session) => session.projectId === project.id && !session.archived),
    now: MOCK_NOW,
    onSelectSession: noop,
    onArchiveSession: noop,
    onNewSession: noop,
    onRenameProject: noop,
    onClearNotifications: noop,
    onCloseProject: noop,
  }
}

describe("SidebarPanel", () => {
  test("resets the rename editor when the selected project changes", async () => {
    const user = userEvent.setup()
    const view = render(<SidebarPanel {...props(projects[0])} />)

    await user.dblClick(screen.getByRole("button", { name: projects[0].name }))
    await user.clear(screen.getByLabelText("Project name"))
    await user.type(screen.getByLabelText("Project name"), "stale name")
    view.rerender(<SidebarPanel {...props(projects[1])} />)

    expect(screen.queryByLabelText("Project name")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: projects[1].name })).toBeInTheDocument()
  })
})
