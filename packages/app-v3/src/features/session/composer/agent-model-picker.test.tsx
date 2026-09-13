import { afterEach, describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen, within } from "@/test/test-utils"
import { AgentModelPicker } from "./agent-model-picker"
import { agents, models, providers } from "@/test/fixtures"
import type { Model, ModelRef, Provider } from "@/lib/types"

describe("AgentModelPicker", () => {
  afterEach(() => localStorage.clear())

  test("manages model visibility from the dropdown and restores focus to the model button", async () => {
    const user = userEvent.setup()
    render(<AgentModelPicker agents={agents} models={models} providers={providers} agentId={agents[0].id}
      model={models[0]} serverUrl="https://models.example" onChangeAgent={() => {}} onChangeModel={() => {}} />)

    const trigger = screen.getByLabelText("Model")
    await user.click(trigger)
    await user.click(screen.getByRole("button", { name: "Manage Models" }))
    const dialog = screen.getByRole("dialog", { name: "Manage Models" })
    expect(within(dialog).getByRole("group", { name: "Model visibility" })).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "Select model" })).not.toBeInTheDocument()
    expect(within(dialog).getByRole("searchbox", { name: "Search models" })).toHaveFocus()
    await user.click(within(dialog).getByRole("switch", { name: models[0].name }))
    await user.keyboard("{Escape}")
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveTextContent(models[0].name)
    await user.click(trigger)
    expect(screen.queryByRole("option", { name: models[0].name })).not.toBeInTheDocument()
    expect(screen.getByRole("option", { selected: true })).toHaveTextContent(models[1].name)
  })

  test("opens a non-modal searchable dropdown and dismisses on outside interaction", async () => {
    const user = userEvent.setup()
    render(<>
      <AgentModelPicker agents={agents} models={models} providers={providers} agentId={agents[0].id}
        model={models[0]} onChangeAgent={() => {}} onChangeModel={() => {}} />
      <button type="button">Outside</button>
    </>)

    await user.click(screen.getByLabelText("Model"))
    expect(screen.getByRole("dialog", { name: "Select model" })).not.toHaveAttribute("aria-modal", "true")
    expect(screen.getByRole("combobox", { name: "Search models" })).toHaveFocus()
    await user.click(screen.getByRole("button", { name: "Outside" }))
    expect(screen.queryByRole("combobox", { name: "Search models" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Outside" })).toHaveFocus()
  })

  test("provider switches affect all models while searching and an empty picker can be restored", async () => {
    const user = userEvent.setup()
    render(<AgentModelPicker agents={agents} models={models} providers={providers} agentId={agents[0].id}
      model={models[0]} serverUrl="https://models.example" onChangeAgent={() => {}} onChangeModel={() => {}} />)

    await user.click(screen.getByLabelText("Model"))
    await user.click(screen.getByRole("button", { name: "Manage Models" }))
    const search = screen.getByRole("searchbox", { name: "Search models" })
    await user.type(search, "sonnet")
    expect(screen.queryByRole("switch", { name: models[1].name })).not.toBeInTheDocument()
    await user.click(screen.getByRole("switch", { name: "All Anthropic models" }))
    await user.clear(search)
    expect(screen.getByRole("switch", { name: models[0].name })).not.toBeChecked()
    expect(screen.getByRole("switch", { name: models[1].name })).not.toBeChecked()
    await user.click(screen.getByRole("switch", { name: "All OpenAI models" }))
    await user.click(screen.getByRole("switch", { name: "All Google models" }))
    await user.keyboard("{Escape}")
    await user.click(screen.getByLabelText("Model"))
    expect(screen.getByText("No models found.")).toBeVisible()
    await user.click(screen.getByRole("button", { name: "Manage Models" }))
    await user.type(screen.getByRole("searchbox", { name: "Search models" }), "open ai")
    expect(screen.getByRole("switch", { name: "GPT-5.2" })).not.toBeChecked()
    await user.click(screen.getByRole("switch", { name: "GPT-5.2" }))
    expect(screen.getByRole("switch", { name: "All OpenAI models" })).toBeChecked()
    await user.keyboard("{Escape}")
    await user.click(screen.getByLabelText("Model"))
    expect(screen.getAllByRole("option")).toHaveLength(1)
    expect(screen.getByRole("option")).toHaveTextContent("GPT-5.2")
  })

  test("opens Manage Models with the keyboard without selecting a model", async () => {
    const user = userEvent.setup()
    const changed: ModelRef[] = []
    render(<AgentModelPicker agents={agents} models={models} providers={providers} agentId={agents[0].id}
      model={models[0]} serverUrl="https://models.example" onChangeAgent={() => {}} onChangeModel={(model) => changed.push(model)} />)
    await user.click(screen.getByLabelText("Model"))
    await user.tab()
    expect(screen.getByRole("button", { name: "Manage Models" })).toHaveFocus()
    await user.keyboard("{Enter}")
    expect(screen.getByRole("dialog", { name: "Manage Models" })).toBeInTheDocument()
    expect(changed).toEqual([])
  })

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
        providers={[]}
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

  test("selects the first available option when the saved model is missing", async () => {
    const user = userEvent.setup()
    const changed: ModelRef[] = []
    render(<AgentModelPicker agents={agents} models={models} providers={providers} agentId={agents[0].id}
      model={{ id: models[0].id, providerId: "unavailable" }} onChangeAgent={() => {}} onChangeModel={(model) => changed.push(model)} />)
    await user.click(screen.getByLabelText("Model"))
    expect(screen.getByRole("option", { selected: true })).toHaveTextContent(models[0].name)
    await user.keyboard("{Enter}")
    expect(changed).toEqual([{ id: models[0].id, providerId: models[0].providerId }])
  })

  test("resets search and highlights the current model on reopen", async () => {
    const user = userEvent.setup()
    render(<AgentModelPicker agents={agents} models={models} providers={providers} agentId={agents[0].id}
      model={models[2]} onChangeAgent={() => {}} onChangeModel={() => {}} />)
    const trigger = screen.getByLabelText("Model")
    await user.click(trigger)
    expect(screen.getByRole("option", { selected: true })).toHaveTextContent(models[2].name)
    await user.type(screen.getByRole("combobox", { name: "Search models" }), "claude")
    await user.keyboard("{Escape}")
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    expect(screen.getByRole("combobox", { name: "Search models" })).toHaveValue("")
    expect(screen.getByRole("option", { selected: true })).toHaveTextContent(models[2].name)
    expect(screen.getAllByRole("option")).toHaveLength(models.length)
  })

  test("ranks prefix matches before substrings and compact matches", async () => {
    const user = userEvent.setup()
    const catalog = ["GPT-5.2", "Cloud GPT52", "GPT52 Preview"].map((name, index) => ({ ...models[2], id: `model-${index}`, name }))
    render(<AgentModelPicker agents={agents} models={catalog} providers={providers} agentId={agents[0].id}
      model={undefined} onChangeAgent={() => {}} onChangeModel={() => {}} />)
    await user.click(screen.getByLabelText("Model"))
    await user.type(screen.getByRole("combobox", { name: "Search models" }), "gpt52")
    expect(screen.getAllByRole("option").map((item) => item.textContent)).toEqual(["GPT52 Preview", "Cloud GPT52", "GPT-5.2"])
  })
})
