import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { MutationError } from "@/mutations/lifecycle"
import { agents, models } from "@/test/fixtures"
import { DefaultsSection } from "./defaults-section"

describe("DefaultsSection", () => {
  test("an excluded default is visibly unavailable and can be replaced", async () => {
    const user = userEvent.setup()
    const changes: string[] = []
    render(<DefaultsSection
      agents={agents.slice(0, 2)} models={models} defaultAgent="compaction"
      onChange={async (key, value) => { changes.push(`${key}:${value}`) }}
    />)
    expect(screen.getByRole("combobox", { name: "Default agent" })).toHaveTextContent("Unavailable (compaction)")
    await user.click(screen.getByRole("combobox", { name: "Default agent" }))
    expect(screen.queryByRole("option", { name: "compaction" })).toBeNull()
    await user.click(screen.getByRole("option", { name: "Build" }))
    expect(changes).toEqual(["defaultAgent:build"])
  })

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
