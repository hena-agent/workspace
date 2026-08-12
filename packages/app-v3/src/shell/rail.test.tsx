import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { Rail } from "./rail"
import { projects } from "@/mock/fixtures"

const hena = projects.filter((p) => p.connectionId === "conn-local")

describe("Rail", () => {
  test("renders one tile per project", () => {
    render(
      <Rail
        projects={hena}
        onSelectProject={() => {}}
        onAddProject={() => {}}
        onOpenSettings={() => {}}
        onOpenHelp={() => {}}
      />,
    )
    for (const project of hena) {
      expect(screen.getByRole("button", { name: project.name })).toBeInTheDocument()
    }
  })

  test("selecting a project calls onSelectProject with its id", async () => {
    const user = userEvent.setup()
    const selected: string[] = []

    render(
      <Rail
        projects={hena}
        onSelectProject={(id) => selected.push(id)}
        onAddProject={() => {}}
        onOpenSettings={() => {}}
        onOpenHelp={() => {}}
      />,
    )

    await user.click(screen.getByRole("button", { name: hena[0].name }))
    expect(selected).toEqual([hena[0].id])
  })

  test("footer actions call their handlers", async () => {
    const user = userEvent.setup()
    let addCount = 0
    let settingsCount = 0
    let helpCount = 0

    render(
      <Rail
        projects={hena}
        onSelectProject={() => {}}
        onAddProject={() => addCount++}
        onOpenSettings={() => settingsCount++}
        onOpenHelp={() => helpCount++}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Open project" }))
    await user.click(screen.getByRole("button", { name: "Settings" }))
    await user.click(screen.getByRole("button", { name: "Help" }))

    expect(addCount).toBe(1)
    expect(settingsCount).toBe(1)
    expect(helpCount).toBe(1)
  })
})
