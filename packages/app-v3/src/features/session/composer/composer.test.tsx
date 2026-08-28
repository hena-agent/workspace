import { afterEach, describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { fireEvent, render, screen, waitFor } from "@/test/test-utils"
import { mockMatchMedia } from "@/test/mock-match-media"
import { Composer } from "./composer"
import { agents, models } from "@/test/fixtures"

const originalMatchMedia = window.matchMedia
afterEach(() => {
  window.matchMedia = originalMatchMedia
})

function setup(sent: string[], hasFinePointer = true, queued: string[] = []) {
  mockMatchMedia(hasFinePointer)
  render(
    <Composer
      agents={agents}
      models={models}
      agentId={agents[0].id}
      modelId={models[0].id}
      onChangeAgent={() => {}}
      onChangeModel={() => {}}
      onSend={(text) => sent.push(text)}
      onQueue={(text) => queued.push(text)}
    />,
  )
}

describe("Composer", () => {
  test("the send button is disabled until there is text", async () => {
    const user = userEvent.setup()
    setup([])

    const send = screen.getByRole("button", { name: "Send message" })
    expect(send).toBeDisabled()

    await user.type(screen.getByLabelText("Message"), "Hello")
    expect(send).toBeEnabled()
  })

  test("clicking send submits and clears the draft", async () => {
    const user = userEvent.setup()
    const sent: string[] = []
    setup(sent)

    await user.type(screen.getByLabelText("Message"), "Ship it")
    await user.click(screen.getByRole("button", { name: "Send message" }))

    expect(sent).toEqual(["Ship it"])
    expect(screen.getByLabelText("Message")).toHaveValue("")
  })

  test("with a fine pointer, Enter sends and Shift+Enter inserts a newline", async () => {
    const user = userEvent.setup()
    const sent: string[] = []
    setup(sent, true)

    const textarea = screen.getByLabelText("Message")
    await user.type(textarea, "line one{Shift>}{Enter}{/Shift}line two")
    expect(sent).toEqual([])
    expect(textarea).toHaveValue("line one\nline two")

    await user.type(textarea, "{Enter}")
    expect(sent).toEqual(["line one\nline two"])
  })

  test("on a coarse-only device, plain Enter inserts a newline instead of sending", async () => {
    const user = userEvent.setup()
    const sent: string[] = []
    setup(sent, false)

    const textarea = screen.getByLabelText("Message")
    await user.type(textarea, "still typing{Enter}")

    expect(sent).toEqual([])
    expect(textarea).toHaveValue("still typing\n")
  })

  test("Mod+Shift+Enter queues and clears the draft", async () => {
    const user = userEvent.setup()
    const sent: string[] = []
    const queued: string[] = []
    setup(sent, false, queued)

    const textarea = screen.getByLabelText("Message")
    await user.type(textarea, "run after this{Control>}{Shift>}{Enter}{/Shift}{/Control}")

    expect(sent).toEqual([])
    expect(queued).toEqual(["run after this"])
    expect(textarea).toHaveValue("")
  })

  test("keeps the draft while an IME composition owns Enter", async () => {
    const user = userEvent.setup()
    const sent: string[] = []
    setup(sent, true)

    const textarea = screen.getByLabelText("Message")
    await user.type(textarea, "未確定")
    expect(fireEvent.keyDown(textarea, { key: "Enter", isComposing: true })).toBe(true)

    expect(sent).toEqual([])
    expect(textarea).toHaveValue("未確定")
  })

  test("shows and removes uploaded attachments", async () => {
    const user = userEvent.setup()
    setup([])

    await user.upload(screen.getByLabelText("Upload files"), new File(["notes"], "notes.txt", { type: "text/plain" }))
    expect(screen.getByText("notes.txt")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Remove notes.txt" }))
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument()
  })

  test("keeps text and attachments when sending fails", async () => {
    const user = userEvent.setup()
    mockMatchMedia(true)
    render(
      <Composer
        agents={agents}
        models={models}
        agentId={agents[0].id}
        modelId={models[0].id}
        onChangeAgent={() => {}}
        onChangeModel={() => {}}
        onSend={() => Promise.reject(new Error("Offline"))}
        onQueue={() => {}}
      />,
    )

    await user.upload(screen.getByLabelText("Upload files"), new File(["notes"], "notes.txt", { type: "text/plain" }))
    await user.type(screen.getByLabelText("Message"), "Retry me")
    await user.click(screen.getByRole("button", { name: "Send message" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Offline")
    expect(screen.getByLabelText("Message")).toHaveValue("Retry me")
    expect(screen.getByText("notes.txt")).toBeInTheDocument()
  })

  test("adds project file mentions to the submitted attachments", async () => {
    const user = userEvent.setup()
    mockMatchMedia(true)
    const sent: { text: string; files?: { uri: string; name?: string }[] }[] = []
    render(
      <Composer
        agents={agents}
        models={models}
        agentId={agents[0].id}
        modelId={models[0].id}
        onChangeAgent={() => {}}
        onChangeModel={() => {}}
        onSend={(text, files) => sent.push({ text, files })}
        onQueue={() => {}}
        onFindFiles={async () => ["src/app.tsx"]}
      />,
    )

    await user.type(screen.getByLabelText("Message"), "Check @app")
    await user.click(await screen.findByText("src/app.tsx"))
    expect(screen.getByLabelText("Message")).toHaveValue("Check @src/app.tsx ")
    await user.click(screen.getByRole("button", { name: "Send message" }))

    expect(sent).toEqual([{ text: "Check @src/app.tsx", files: [{ uri: "file:src/app.tsx", name: "src/app.tsx" }] }])
  })

  test("uses the AI Elements submit control to stop a working session", async () => {
    const user = userEvent.setup()
    mockMatchMedia(true)
    let stopped = 0
    render(
      <Composer
        agents={agents}
        models={models}
        agentId={agents[0].id}
        modelId={models[0].id}
        onChangeAgent={() => {}}
        onChangeModel={() => {}}
        onSend={() => {}}
        onQueue={() => {}}
        working
        onStop={() => stopped++}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Stop session" }))
    expect(stopped).toBe(1)
  })

  test("persists the attachment count when a file is added", async () => {
    const user = userEvent.setup()
    mockMatchMedia(true)
    const drafts: { droppedAttachments: number }[] = []
    render(
      <Composer
        agents={agents}
        models={models}
        agentId={agents[0].id}
        modelId={models[0].id}
        onChangeAgent={() => {}}
        onChangeModel={() => {}}
        onSend={() => {}}
        onQueue={() => {}}
        onDraftChange={(draft) => drafts.push(draft)}
      />,
    )

    await user.upload(screen.getByLabelText("Upload files"), new File(["notes"], "notes.txt", { type: "text/plain" }))

    expect(drafts.at(-1)?.droppedAttachments).toBe(1)
  })

  test("does not leak queue delivery from an empty submission", async () => {
    const user = userEvent.setup()
    const sent: string[] = []
    const queued: string[] = []
    setup(sent, false, queued)
    const textarea = screen.getByLabelText("Message")

    await user.type(textarea, " ")
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(textarea).toHaveValue(""))
    await user.type(textarea, "send normally")
    await user.click(screen.getByRole("button", { name: "Send message" }))

    expect(sent).toEqual(["send normally"])
    expect(queued).toEqual([])
  })

  test("locks the composer until delivery finishes", async () => {
    const user = userEvent.setup()
    const delivery = Promise.withResolvers<void>()
    mockMatchMedia(true)
    render(
      <Composer
        agents={agents}
        models={models}
        agentId={agents[0].id}
        modelId={models[0].id}
        onChangeAgent={() => {}}
        onChangeModel={() => {}}
        onSend={() => delivery.promise}
        onQueue={() => {}}
      />,
    )
    const textarea = screen.getByLabelText("Message")

    await user.type(textarea, "Wait for me")
    await user.click(screen.getByRole("button", { name: "Send message" }))
    expect(textarea).toBeDisabled()
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled()

    delivery.resolve()
    await waitFor(() => expect(textarea).toHaveValue(""))
    expect(textarea).toBeEnabled()
  })

  test("hides file mention results while delivery is pending", async () => {
    const delivery = Promise.withResolvers<void>()
    mockMatchMedia(true)
    render(
      <Composer
        agents={agents}
        models={models}
        agentId={agents[0].id}
        modelId={models[0].id}
        onChangeAgent={() => {}}
        onChangeModel={() => {}}
        onSend={() => delivery.promise}
        onQueue={() => {}}
        onFindFiles={async () => ["src/app.tsx"]}
        initialText="Check @app"
        initialSelection={{ start: 10, end: 10 }}
      />,
    )

    const textarea = screen.getByLabelText("Message")
    expect(await screen.findByText("src/app.tsx")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Send message" }))
    expect(screen.queryByText("src/app.tsx")).not.toBeInTheDocument()

    delivery.resolve()
    await waitFor(() => expect(textarea).toBeEnabled())
  })
})
