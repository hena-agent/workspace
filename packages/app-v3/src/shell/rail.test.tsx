import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
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
        onAddProject={() => {}}
        onOpenSettings={() => {}}
      />,
    )

    const project = screen.getByRole("button", { name: "External, needs your input, working" })
    expect(project).toHaveAccessibleName("External, needs your input, working")
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
        onAddProject={() => {}}
        onOpenSettings={() => {}}
      />,
    )

    expect(screen.getByRole("button", { name: "Shared (/workspace-0, alpha)" })).toHaveAttribute(
      "aria-pressed",
      "false",
    )
    expect(screen.getByRole("button", { name: "Shared (/workspace-1, beta)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    expect(screen.getByRole("button", { name: "Shared (/workspace-2, alpha)" })).toHaveAttribute(
      "aria-pressed",
      "false",
    )
    await user.click(screen.getByRole("button", { name: "Shared (/workspace-2, alpha)" }))
    expect(selected).toEqual(["project-2"])
  })
})
