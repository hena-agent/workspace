import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import type { Project } from "@/lib/types"
import { act, fireEvent, render, screen } from "@/test/test-utils"
import { Rail } from "./rail"

describe("Rail", () => {
  test("renders notification state supplied by its owner", () => {
    render(
      <Rail
        projects={[
          {
            project: {
              id: "external-project",
              connectionId: "external-connection",
              name: "External",
              path: "/external",
              updatedAt: 0,
            },
            notification: { kind: "permission", working: true },
          },
        ]}
        onSelectProject={() => {}}
        onReorderProjects={() => {}}
        onAddProject={() => {}}
        onOpenSettings={() => {}}
      />,
    )

    const project = screen.getByRole("button", { name: "External, needs your input, working" })
    expect(project).toHaveAccessibleName("External, needs your input, working")
    expect(project).toHaveClass("cursor-default")
    expect(project).not.toHaveClass("cursor-grab", "cursor-grabbing")
    expect(project.querySelector(".bg-\\[var\\(--legacy-warning\\)\\]")).toBeInTheDocument()
    expect(project.querySelector(".animate-spin")).toBeInTheDocument()
  })

  test("keeps duplicate project labels distinct within and across connections", async () => {
    const user = userEvent.setup()
    const selected: string[] = []
    const duplicateProjects = ["alpha", "beta", "alpha"].map((connectionId, index) => ({
      project: {
        id: index < 2 ? "shared-project" : `project-${index}`,
        connectionId,
        name: "Shared",
        path: `/workspace-${index}`,
        updatedAt: 0,
      },
      notification: { kind: "none" as const, working: false },
    }))

    render(
      <Rail
        projects={duplicateProjects}
        selectedProject={duplicateProjects[1].project}
        onSelectProject={(project) => selected.push(project.id)}
        onReorderProjects={() => {}}
        onAddProject={() => {}}
        onOpenSettings={() => {}}
      />,
    )

    expect(screen.getByRole("button", { name: "Shared (/workspace-0, alpha)" })).toHaveAttribute(
      "aria-pressed",
      "false",
    )
    expect(screen.getByRole("button", { name: "Shared (/workspace-1, beta)" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Shared (/workspace-2, alpha)" })).toHaveAttribute(
      "aria-pressed",
      "false",
    )
    await user.click(screen.getByRole("button", { name: "Shared (/workspace-2, alpha)" }))
    expect(selected).toEqual(["project-2"])
  })

  test("reorders with the keyboard and restores the initial order on cancel", () => {
    const reordered: string[][] = []
    const input = ["Alpha", "Beta", "Gamma"].map((name, index) => ({
      id: name.toLowerCase(),
      connectionId: "local",
      name,
      path: `/${name.toLowerCase()}`,
      updatedAt: index,
    }))

    function ReorderableRail() {
      const [projects, setProjects] = useState(input)
      return (
        <Rail
          projects={projects.map((project) => ({
            project,
            notification: { kind: "none" as const, working: false },
          }))}
          onSelectProject={() => {}}
          onReorderProjects={(next: Project[]) => {
            reordered.push(next.map((project) => project.id))
            setProjects(next)
          }}
          onAddProject={() => {}}
          onOpenSettings={() => {}}
        />
      )
    }

    render(<ReorderableRail />)
    const alpha = screen.getByRole("button", { name: "Alpha" })
    act(() => alpha.focus())
    fireEvent.keyDown(alpha, { key: " " })
    fireEvent.keyDown(alpha, { key: "ArrowDown" })

    expect(reordered.at(-1)).toEqual(["beta", "alpha", "gamma"])
    expect(screen.getByText("Alpha moved to position 2 of 3.")).toBeInTheDocument()

    fireEvent.keyDown(alpha, { key: "Escape" })
    expect(reordered.at(-1)).toEqual(["alpha", "beta", "gamma"])
    expect(screen.getByText("Alpha movement canceled.")).toBeInTheDocument()
  })
})
