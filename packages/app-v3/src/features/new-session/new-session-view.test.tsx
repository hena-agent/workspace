import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { NewSessionView } from "./new-session-view"
import { agents, models, projects } from "@/test/fixtures"
import type { ModelRef } from "@/lib/types"

describe("NewSessionView", () => {
  test("renders the target project", () => {
    render(<NewSessionView project={projects[0]} agents={agents} models={models} onStart={() => {}} />)
    expect(screen.getByText(projects[0].name, { exact: false })).toBeInTheDocument()
  })

  test("sending the composer calls onStart with the text, agent, and model", async () => {
    const user = userEvent.setup()
    let started: { text: string; agentId: string; model: ModelRef | undefined; delivery: "send" | "queue" } | undefined

    render(
      <NewSessionView project={projects[0]} agents={agents} models={models} onStart={(params) => (started = params)} />,
    )

    await user.type(screen.getByLabelText("Message"), "Set up the new feature flag")
    await user.click(screen.getByRole("button", { name: "Send message" }))

    expect(started).toEqual({
      text: "Set up the new feature flag",
      agentId: agents[0].id,
      model: models[0],
      delivery: "send",
    })
  })

  test("queueing the first prompt preserves its delivery mode", async () => {
    const user = userEvent.setup()
    let delivery: "send" | "queue" | undefined

    render(
      <NewSessionView
        project={projects[0]}
        agents={agents}
        models={models}
        onStart={(params) => (delivery = params.delivery)}
      />,
    )

    await user.type(screen.getByLabelText("Message"), "Run next{Control>}{Shift>}{Enter}{/Shift}{/Control}")
    expect(delivery).toBe("queue")
  })

  test("uses the synchronized queue delivery default for a normal send", async () => {
    const user = userEvent.setup()
    let delivery: "send" | "queue" | undefined
    render(
      <NewSessionView
        project={projects[0]}
        agents={agents}
        models={models}
        defaultDelivery="queue"
        onStart={(params) => (delivery = params.delivery)}
      />,
    )

    await user.type(screen.getByLabelText("Message"), "Run after current work")
    await user.click(screen.getByRole("button", { name: "Send message" }))

    expect(delivery).toBe("queue")
  })
})
