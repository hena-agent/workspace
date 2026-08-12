import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { RailProjectTile } from "./rail-project-tile"
import type { Project } from "@/lib/types"

const project: Project = {
  id: "proj-hena",
  connectionId: "conn-local",
  name: "hena",
  path: "~/code/hena",
  color: "purple",
  updatedAt: 0,
}

describe("RailProjectTile", () => {
  test("calls onSelect when clicked", async () => {
    const user = userEvent.setup()
    const onSelect = () => {
      called = true
    }
    let called = false

    render(
      <RailProjectTile
        project={project}
        selected={false}
        notification={{ kind: "none", working: false }}
        onSelect={onSelect}
      />,
    )

    await user.click(screen.getByRole("button", { name: "hena" }))
    expect(called).toBe(true)
  })

  test("reflects selected state via aria-pressed", () => {
    render(
      <RailProjectTile
        project={project}
        selected
        notification={{ kind: "none", working: false }}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByRole("button", { name: "hena" })).toHaveAttribute("aria-pressed", "true")
  })

  test("does not render a notification dot when there is nothing to report", () => {
    const { container } = render(
      <RailProjectTile
        project={project}
        selected={false}
        notification={{ kind: "none", working: false }}
        onSelect={() => {}}
      />,
    )
    expect(container.querySelector("[aria-hidden]")).not.toBeInTheDocument()
  })

  test("renders a notification dot when there is a pending signal", () => {
    const { container } = render(
      <RailProjectTile
        project={project}
        selected={false}
        notification={{ kind: "permission", working: false }}
        onSelect={() => {}}
      />,
    )
    expect(container.querySelector("[aria-hidden]")).toBeInTheDocument()
  })
})
