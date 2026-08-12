import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { SidebarPanelHeader } from "./sidebar-panel-header"
import type { Project } from "@/lib/types"

const project: Project = {
  id: "proj-hena",
  connectionId: "conn-local",
  name: "hena",
  path: "~/code/hena",
  color: "purple",
  updatedAt: 0,
}

describe("SidebarPanelHeader", () => {
  test("renders the project name and path", () => {
    render(
      <SidebarPanelHeader project={project} onRename={() => {}} onClearNotifications={() => {}} onClose={() => {}} />,
    )
    expect(screen.getByText("hena")).toBeInTheDocument()
    expect(screen.getByText("~/code/hena")).toBeInTheDocument()
  })

  test("double-clicking the name enters rename mode and Enter commits it", async () => {
    const user = userEvent.setup()
    const names: string[] = []

    render(
      <SidebarPanelHeader
        project={project}
        onRename={(name) => names.push(name)}
        onClearNotifications={() => {}}
        onClose={() => {}}
      />,
    )

    await user.dblClick(screen.getByText("hena"))
    const input = screen.getByLabelText("Project name")
    await user.clear(input)
    await user.type(input, "hena-renamed{Enter}")

    expect(names).toEqual(["hena-renamed"])
  })

  test("Escape while renaming discards the draft", async () => {
    const user = userEvent.setup()
    const names: string[] = []

    render(
      <SidebarPanelHeader
        project={project}
        onRename={(name) => names.push(name)}
        onClearNotifications={() => {}}
        onClose={() => {}}
      />,
    )

    await user.dblClick(screen.getByText("hena"))
    await user.type(screen.getByLabelText("Project name"), " nope")
    await user.keyboard("{Escape}")

    expect(names).toEqual([])
    expect(screen.getByText("hena")).toBeInTheDocument()
  })

  test("the menu exposes clear-notifications and close actions", async () => {
    const user = userEvent.setup()
    let cleared = false
    let closed = false

    render(
      <SidebarPanelHeader
        project={project}
        onRename={() => {}}
        onClearNotifications={() => (cleared = true)}
        onClose={() => (closed = true)}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Project actions" }))
    await user.click(await screen.findByText("Clear notifications"))
    expect(cleared).toBe(true)

    await user.click(screen.getByRole("button", { name: "Project actions" }))
    await user.click(await screen.findByText("Close project"))
    expect(closed).toBe(true)
  })
})
