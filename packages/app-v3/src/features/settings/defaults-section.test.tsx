import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { MutationError } from "@/mutations/lifecycle"
import { agents, models } from "@/test/fixtures"
import { DefaultsSection } from "./defaults-section"

describe("DefaultsSection", () => {
  test("shows the saved state after an authoritative setting update", async () => {
    const user = userEvent.setup()
    render(<DefaultsSection agents={agents} models={models} queueDelivery="steer" onChange={() => Promise.resolve()} />)

    await user.click(screen.getByRole("combobox", { name: "Prompt delivery" }))
    await user.click(screen.getByRole("option", { name: "Queue" }))

    expect(await screen.findByRole("status")).toHaveTextContent("Saved")
  })

  test("keeps the attempted value editable and shows the authoritative value after a conflict", async () => {
    const user = userEvent.setup()
    render(
      <DefaultsSection
        agents={agents}
        models={models}
        queueDelivery="steer"
        onChange={() => Promise.reject(new MutationError("Revision changed", "revision_conflict"))}
      />,
    )

    await user.click(screen.getByRole("combobox", { name: "Prompt delivery" }))
    await user.click(screen.getByRole("option", { name: "Queue" }))

    expect(await screen.findByRole("status")).toHaveTextContent("Conflicted. Server value: steer")
    expect(screen.getByRole("combobox", { name: "Prompt delivery" })).toHaveTextContent("Queue")
    expect(screen.getByRole("alert")).toHaveTextContent("Revision changed")
  })
})
