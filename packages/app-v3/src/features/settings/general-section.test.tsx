import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { GeneralSection } from "./general-section"

describe("GeneralSection", () => {
  test("changing the theme calls onChangeTheme", async () => {
    const user = userEvent.setup()
    const changed: string[] = []

    render(
      <GeneralSection
        theme="system"
        onChangeTheme={(t) => changed.push(t)}
        density="comfortable"
        onChangeDensity={() => {}}
      />,
    )

    await user.click(screen.getByLabelText("Theme"))
    await user.click(await screen.findByText("Dark"))

    expect(changed).toEqual(["dark"])
  })

  test("changing the density calls onChangeDensity", async () => {
    const user = userEvent.setup()
    const changed: string[] = []

    render(
      <GeneralSection
        theme="system"
        onChangeTheme={() => {}}
        density="comfortable"
        onChangeDensity={(d) => changed.push(d)}
      />,
    )

    await user.click(screen.getByLabelText("Density"))
    await user.click(await screen.findByText("Compact"))

    expect(changed).toEqual(["compact"])
  })
})
