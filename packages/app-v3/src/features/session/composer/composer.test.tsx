import { afterEach, describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { fireEvent, render, screen } from "@/test/test-utils"
import { mockMatchMedia } from "@/test/mock-match-media"
import { Composer } from "./composer"
import { agents, models } from "@/mock/fixtures"

const originalMatchMedia = window.matchMedia
afterEach(() => {
  window.matchMedia = originalMatchMedia
})

function setup(sent: string[], hasFinePointer = true) {
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
})
