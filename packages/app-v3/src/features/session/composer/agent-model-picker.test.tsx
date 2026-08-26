import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { AgentModelPicker } from "./agent-model-picker"
import { agents, models } from "@/test/fixtures"

describe("AgentModelPicker", () => {
  test("shows the currently selected agent and model", () => {
    render(
      <AgentModelPicker
        agents={agents}
        models={models}
        agentId={agents[0].id}
        modelId={models[0].id}
        onChangeAgent={() => {}}
        onChangeModel={() => {}}
      />,
    )
    expect(screen.getByLabelText("Agent")).toHaveClass("min-h-[var(--hit-area)]")
    expect(screen.getByLabelText("Agent")).toHaveTextContent(agents[0].name)
    expect(screen.getByLabelText("Model")).toHaveTextContent(models[0].name)
    expect(screen.queryByText(models[1].name)).not.toBeInTheDocument()
  })

  test("selecting a different agent calls onChangeAgent with its id", async () => {
    const user = userEvent.setup()
    const changed: string[] = []

    render(
      <AgentModelPicker
        agents={agents}
        models={models}
        agentId={agents[0].id}
        modelId={models[0].id}
        onChangeAgent={(id) => changed.push(id)}
        onChangeModel={() => {}}
      />,
    )

    await user.click(screen.getByLabelText("Agent"))
    const option = await screen.findByText(agents[1].name)
    expect(option.closest('[data-slot="select-item"]')).toHaveClass("min-h-[var(--hit-area)]")
    await user.click(option)

    expect(changed).toEqual([agents[1].id])
  })

  test("shows a placeholder instead of rendering blank when no agent or model is selected", () => {
    render(
      <AgentModelPicker
        agents={[]}
        models={[]}
        agentId=""
        modelId=""
        onChangeAgent={() => {}}
        onChangeModel={() => {}}
      />,
    )
    expect(screen.getByLabelText("Agent")).toHaveTextContent("Agent")
    expect(screen.getByLabelText("Model")).toHaveTextContent("Model")
  })

  test("searches models across separators and provider IDs", async () => {
    const user = userEvent.setup()
    const changed: string[] = []

    render(
      <AgentModelPicker
        agents={agents}
        models={models}
        agentId={agents[0].id}
        modelId={models[0].id}
        onChangeAgent={() => {}}
        onChangeModel={(id) => changed.push(id)}
      />,
    )

    await user.click(screen.getByLabelText("Model"))
    await user.type(screen.getByPlaceholderText("Search models…"), "open ai")
    expect(screen.getByText("GPT-5.2")).toBeInTheDocument()
    expect(screen.queryByText("Claude Opus 5")).not.toBeInTheDocument()

    await user.clear(screen.getByPlaceholderText("Search models…"))
    await user.type(screen.getByPlaceholderText("Search models…"), "gpt52")
    await user.click(screen.getByText("GPT-5.2"))
    expect(changed).toEqual(["gpt-5.2"])
  })
})
