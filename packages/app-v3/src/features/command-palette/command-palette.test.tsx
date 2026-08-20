import type { ComponentProps } from "react"
import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { CommandPalette } from "./command-palette"
import { projects, serverCommands, sessions } from "@/mock/fixtures"

const henaProjects = projects.filter((p) => p.connectionId === "conn-local")
const henaSessions = sessions.filter((s) => s.projectId === "proj-hena" && !s.archived)

function noop() {}

function renderPalette(overrides: Partial<ComponentProps<typeof CommandPalette>> = {}) {
  return render(
    <CommandPalette
      open
      onOpenChange={noop}
      projects={henaProjects}
      sessions={henaSessions}
      serverCommands={serverCommands}
      onSelectProject={noop}
      onSelectSession={noop}
      onRunServerCommand={noop}
      onOpenSettings={noop}
      {...overrides}
    />,
  )
}

describe("CommandPalette", () => {
  test("renders nothing when closed", () => {
    renderPalette({ open: false })
    expect(screen.queryByPlaceholderText(/Search projects/)).not.toBeInTheDocument()
  })

  test("lists projects, sessions, and server commands when open", () => {
    renderPalette()
    expect(screen.getByText(henaProjects[0].name)).toBeInTheDocument()
    expect(screen.getByText(henaSessions[0].title)).toBeInTheDocument()
    expect(screen.getByText(serverCommands[0].name)).toBeInTheDocument()
  })

  test("selecting a project calls onSelectProject and closes the palette", async () => {
    const user = userEvent.setup()
    const selected: string[] = []
    let closed = false

    renderPalette({
      onOpenChange: (open) => {
        if (!open) closed = true
      },
      onSelectProject: (project) => selected.push(project.id),
    })

    await user.click(screen.getByText(henaProjects[0].name))
    expect(selected).toEqual([henaProjects[0].id])
    expect(closed).toBe(true)
  })

  test("keeps duplicate project and session labels distinct across projects and connections", async () => {
    const user = userEvent.setup()
    const selectedProjects: string[] = []
    const selectedSessions: string[] = []
    const duplicateProjects = ["alpha", "beta", "alpha"].map((connectionId, index) => ({
      ...henaProjects[0],
      id: index < 2 ? "shared-project" : `project-${index}`,
      connectionId,
      path: `/workspace-${index}`,
    }))
    const duplicateSessions = [
      ...duplicateProjects.map((project, index) => ({
        ...henaSessions[0],
        id: index < 2 ? "shared-session" : `session-${index}`,
        connectionId: project.connectionId,
        projectId: project.id,
      })),
      {
        ...henaSessions[0],
        id: "session-3",
        connectionId: duplicateProjects[2].connectionId,
        projectId: duplicateProjects[2].id,
      },
    ]

    renderPalette({
      projects: duplicateProjects,
      sessions: [],
      onSelectProject: (project) => selectedProjects.push(project.id),
    })
    await user.click(
      screen.getByText(
        `${duplicateProjects[2].name} (${duplicateProjects[2].path}, ${duplicateProjects[2].connectionId})`,
      ),
    )
    expect(selectedProjects).toEqual(["project-2"])

    renderPalette({
      projects: duplicateProjects,
      sessions: duplicateSessions,
      onSelectSession: (session) => selectedSessions.push(session.id),
    })
    await user.click(
      screen.getByText(
        `${duplicateSessions[3].title} (${duplicateProjects[2].path}, ${duplicateSessions[3].connectionId}, ${duplicateSessions[3].id})`,
      ),
    )
    expect(selectedSessions).toEqual(["session-3"])
  })

  test("selecting a server command calls onRunServerCommand and closes the palette", async () => {
    const user = userEvent.setup()
    const ran: string[] = []

    renderPalette({ onRunServerCommand: (command) => ran.push(command.id) })
    await user.click(screen.getByText(serverCommands[0].name))

    expect(ran).toEqual([serverCommands[0].id])
  })

  test("typing filters the list", async () => {
    const user = userEvent.setup()
    renderPalette()

    await user.type(screen.getByPlaceholderText(/Search projects/), henaProjects[1].name)
    expect(screen.getByText(henaProjects[1].name)).toBeInTheDocument()
    expect(screen.queryByText(henaProjects[0].name)).not.toBeInTheDocument()
  })
})
