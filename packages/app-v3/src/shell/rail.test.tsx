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

    const project = screen.getByRole("button", { name: "External" })
    expect(project.querySelector(".bg-\\[var\\(--legacy-warning\\)\\]")).toBeInTheDocument()
    expect(project.querySelector(".animate-spin")).toBeInTheDocument()
  })

  test("keeps duplicate project identities distinct across connections", async () => {
    const user = userEvent.setup()
    const selected: string[] = []
    const duplicateProjects = ["alpha", "beta"].map((connectionId) => ({
      project: {
        id: "shared-id",
        connectionId,
        name: "Shared",
        path: `/${connectionId}`,
        updatedAt: 0,
      },
      notification: { kind: "none" as const, working: false },
    }))

    render(
      <Rail
        projects={duplicateProjects}
        selectedProject={duplicateProjects[1].project}
        onSelectProject={(project) => selected.push(project.connectionId)}
        onAddProject={() => {}}
        onOpenSettings={() => {}}
      />,
    )

    expect(screen.getByRole("button", { name: "Shared (alpha)" })).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByRole("button", { name: "Shared (beta)" })).toHaveAttribute("aria-pressed", "true")
    await user.click(screen.getByRole("button", { name: "Shared (alpha)" }))
    expect(selected).toEqual(["alpha"])
  })
})
