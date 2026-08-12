import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { SettingsNav } from "./settings-nav"

const sections = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
] as const

describe("SettingsNav", () => {
  test("marks the active section", () => {
    render(<SettingsNav sections={sections} active="appearance" onSelect={() => {}} />)
    expect(screen.getByRole("button", { name: "Appearance" })).toHaveAttribute("aria-current", "true")
    expect(screen.getByRole("button", { name: "General" })).not.toHaveAttribute("aria-current")
  })

  test("selecting a section calls onSelect with its id", async () => {
    const user = userEvent.setup()
    const selected: string[] = []

    render(<SettingsNav sections={sections} active="general" onSelect={(id) => selected.push(id)} />)
    await user.click(screen.getByRole("button", { name: "Appearance" }))

    expect(selected).toEqual(["appearance"])
  })
})
