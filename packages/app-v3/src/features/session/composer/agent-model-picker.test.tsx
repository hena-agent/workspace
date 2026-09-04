import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen, within } from "@/test/test-utils"
import { AgentModelPicker } from "./agent-model-picker"
import { agents, models, providers } from "@/test/fixtures"
import type { Model, ModelRef, Provider } from "@/lib/types"

describe("AgentModelPicker", () => {
  test("shows the currently selected agent and model", () => {
    render(
      <AgentModelPicker
        agents={agents}
        models={models}
        providers={providers}
        agentId={agents[0].id}
        model={models[0]}
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
        providers={providers}
        agentId={agents[0].id}
        model={models[0]}
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
        model={undefined}
        onChangeAgent={() => {}}
        onChangeModel={() => {}}
      />,
    )
    expect(screen.getByLabelText("Agent")).toHaveTextContent("Agent")
    expect(screen.getByLabelText("Model")).toHaveTextContent("Model")
  })

  test("groups models under their real provider name", async () => {
    const user = userEvent.setup()
    render(
      <AgentModelPicker
        agents={agents}
        models={models}
        providers={providers}
        agentId={agents[0].id}
        model={models[0]}
        onChangeAgent={() => {}}
        onChangeModel={() => {}}
      />,
    )

    await user.click(screen.getByLabelText("Model"))
    expect(screen.getByText("Anthropic")).toBeInTheDocument()
    expect(screen.getByText("OpenAI")).toBeInTheDocument()
    expect(screen.getByText("Google")).toBeInTheDocument()
  })

  test("opens with every model visible and no empty state", async () => {
    const user = userEvent.setup()
    render(
      <AgentModelPicker
        agents={agents}
        models={models}
        providers={providers}
        agentId={agents[0].id}
        model={models[0]}
        onChangeAgent={() => {}}
        onChangeModel={() => {}}
      />,
    )

    await user.click(screen.getByLabelText("Model"))
    const dialog = screen.getByRole("dialog")
    for (const model of models) expect(within(dialog).getByText(model.name)).toBeVisible()
    expect(screen.queryByText("No models found.")).not.toBeInTheDocument()
  })

  test("searches models across separators and provider IDs", async () => {
    const user = userEvent.setup()
    const changed: ModelRef[] = []

    render(
      <AgentModelPicker
        agents={agents}
        models={models}
        providers={providers}
        agentId={agents[0].id}
        model={models[0]}
        onChangeAgent={() => {}}
        onChangeModel={(model) => changed.push(model)}
      />,
    )

    await user.click(screen.getByLabelText("Model"))
    await user.type(screen.getByPlaceholderText("Search models…"), "open ai")
    expect(screen.getByText("GPT-5.2")).toBeVisible()
    expect(screen.queryByText("Claude Opus 5")).not.toBeInTheDocument()

    await user.clear(screen.getByPlaceholderText("Search models…"))
    await user.type(screen.getByPlaceholderText("Search models…"), "gpt52")
    await user.click(screen.getByText("GPT-5.2"))
    expect(changed).toEqual([{ id: "gpt-5.2", providerId: "openai" }])
  })

  test("shows the empty state and hides every model when nothing matches", async () => {
    const user = userEvent.setup()
    render(
      <AgentModelPicker
        agents={agents}
        models={models}
        providers={providers}
        agentId={agents[0].id}
        model={models[0]}
        onChangeAgent={() => {}}
        onChangeModel={() => {}}
      />,
    )

    await user.click(screen.getByLabelText("Model"))
    const dialog = screen.getByRole("dialog")
    await user.type(screen.getByPlaceholderText("Search models…"), "zzz-not-a-model")
    expect(screen.getByText("No models found.")).toBeInTheDocument()
    for (const model of models) expect(within(dialog).queryByText(model.name)).not.toBeInTheDocument()
  })

  test("keyboard navigation selects the next match and Enter confirms it", async () => {
    const user = userEvent.setup()
    const changed: ModelRef[] = []

    render(
      <AgentModelPicker
        agents={agents}
        models={models}
        providers={providers}
        agentId={agents[0].id}
        model={models[0]}
        onChangeAgent={() => {}}
        onChangeModel={(model) => changed.push(model)}
      />,
    )

    await user.click(screen.getByLabelText("Model"))
    await user.type(screen.getByPlaceholderText("Search models…"), "claude")
    await user.keyboard("{ArrowDown}{Enter}")

    expect(changed).toEqual([{ id: "claude-opus-5", providerId: "anthropic" }])
  })

  test("disambiguates models that share an id across providers", async () => {
    const user = userEvent.setup()
    const changed: ModelRef[] = []
    const duplicateModels: Model[] = [
      { id: "shared-model", providerId: "openai", name: "Shared Model", contextWindow: 100_000 },
      { id: "shared-model", providerId: "openrouter", name: "Shared Model", contextWindow: 100_000 },
    ]
    const duplicateProviders: Provider[] = [
      { id: "openai", name: "OpenAI", connected: true },
      { id: "openrouter", name: "OpenRouter", connected: true },
    ]

    render(
      <AgentModelPicker
        agents={agents}
        models={duplicateModels}
        providers={duplicateProviders}
        agentId={agents[0].id}
        model={{ id: "shared-model", providerId: "openrouter" }}
        onChangeAgent={() => {}}
        onChangeModel={(model) => changed.push(model)}
      />,
    )

    await user.click(screen.getByLabelText("Model"))
    const dialog = screen.getByRole("dialog")
    const items = within(dialog)
      .getAllByText("Shared Model")
      .map((element) => element.closest('[data-slot="command-item"]'))
    expect(items.map((item) => item?.getAttribute("data-checked"))).toEqual(["false", "true"])

    await user.click(items[0]!)
    expect(changed).toEqual([{ id: "shared-model", providerId: "openai" }])
  })
})
