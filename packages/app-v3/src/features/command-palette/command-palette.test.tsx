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
      onSelectProject: (id) => selected.push(id),
    })

    await user.click(screen.getByText(henaProjects[0].name))
    expect(selected).toEqual([henaProjects[0].id])
    expect(closed).toBe(true)
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
