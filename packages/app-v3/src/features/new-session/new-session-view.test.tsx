import { afterEach, describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen, within } from "@/test/test-utils"
import { NewSessionView } from "./new-session-view"
import { agents, models, projects, providers } from "@/test/fixtures"
import type { ModelRef } from "@/lib/types"
import { saveDraft, type DraftBody } from "@/local-state/drafts"

afterEach(() => localStorage.clear())

describe("NewSessionView", () => {
  test("renders the target project", () => {
    render(<NewSessionView project={projects[0]} agents={agents} models={models} providers={providers} onStart={() => {}} />)
    expect(screen.getByText(projects[0].name, { exact: false })).toBeInTheDocument()
  })

  test("sending the composer calls onStart with the text, agent, and model", async () => {
    const user = userEvent.setup()
    let started: { text: string; agentId: string; model: ModelRef | undefined; delivery: "send" | "queue" } | undefined

    render(
      <NewSessionView project={projects[0]} agents={agents} models={models} providers={providers} onStart={(params) => (started = params)} />,
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
        providers={providers}
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
        providers={providers}
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

  test("resolves a legacy draft after the catalog loads and persists its provider", async () => {
    const user = userEvent.setup()
    const drafts: DraftBody[] = []
    const started: (ModelRef | undefined)[] = []
    const props = {
      project: projects[0], agents, providers,
      draft: { text: "keep me", modelID: models[2].id, selection: { start: 7, end: 7 }, delivery: "steer", droppedAttachments: 0 } satisfies DraftBody,
      defaultModel: models[0],
      onDraftChange: (draft: DraftBody) => drafts.push(draft),
      onStart: (input: { model: ModelRef | undefined }) => started.push(input.model),
    }
    const view = render(<NewSessionView {...props} models={[]} />)
    await user.type(screen.getByLabelText("Message"), "!")
    expect(drafts.at(-1)?.modelID).toBe(models[2].id)
    expect(drafts.at(-1)?.model).toBeUndefined()

    view.rerender(<NewSessionView {...props} models={models} />)
    expect(screen.getByLabelText("Model")).toHaveTextContent(models[2].name)
    await user.type(screen.getByLabelText("Message"), "!")
    expect(drafts.at(-1)?.model).toMatchObject({ id: models[2].id, providerId: models[2].providerId })
    const promoted = saveDraft("http://legacy-test", "draft", "/draft", drafts.at(-1)!)
    expect(promoted.modelID).toBeUndefined()
    view.rerender(<NewSessionView {...props} models={models} draft={promoted} />)
    expect(screen.getByLabelText("Model")).toHaveTextContent(models[2].name)
    await user.click(screen.getByRole("button", { name: "Send message" }))
    expect(started).toEqual([models[2]])
  })

  test.each(["ambiguous", "missing"])("requires reselection for a %s legacy model on both send and queue", async (kind) => {
    const user = userEvent.setup()
    const started: (ModelRef | undefined)[] = []
    const drafts: DraftBody[] = []
    const catalog = [...models, { ...models[2], providerId: "azure" }]
    const id = kind === "ambiguous" ? models[2].id : "not-available"
    render(<NewSessionView
      project={projects[0]} agents={agents} models={catalog} providers={[...providers, { id: "azure", name: "Azure", connected: true }]}
      defaultModel={models[0]}
      draft={{ text: "keep me", modelID: id, selection: { start: 7, end: 7 }, delivery: "steer", droppedAttachments: 0 }}
      onStart={(input) => started.push(input.model)}
      onDraftChange={(draft) => drafts.push(draft)}
    />)
    expect(screen.getByLabelText("Model")).toHaveTextContent("Model")
    await user.type(screen.getByLabelText("Message"), "!")
    expect(drafts.at(-1)?.modelID).toBe(id)
    await user.click(screen.getByRole("button", { name: "Send message" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Select a model before sending")
    await user.click(screen.getByLabelText("Message"))
    await user.keyboard("{Control>}{Shift>}{Enter}{/Shift}{/Control}")
    expect(started).toEqual([])
    expect(screen.getByLabelText("Message")).toHaveValue("keep me!")

    await user.click(screen.getByLabelText("Model"))
    await user.click(within(screen.getByRole("group", { name: "Azure" })).getByRole("option", { name: models[2].name }))
    await user.click(screen.getByRole("button", { name: "Send message" }))
    expect(started).toEqual([{ ...models[2], providerId: "azure" }])
  })
})
