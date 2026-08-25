import { describe, expect, test } from "bun:test"
import { fireEvent, render, screen } from "@/test/test-utils"
import { MessageList } from "./message-list"
import { listMessages } from "@/test/queries"

describe("MessageList", () => {
  test("shows an empty state when there are no messages", () => {
    render(<MessageList messages={[]} />)
    expect(screen.getByText("No messages yet. Say something to get started.")).toBeInTheDocument()
  })

  test("renders every message in the log in order", () => {
    const messages = listMessages({
      sessionId: "sess-transcript",
      connectionId: "conn-local",
      projectId: "proj-hena",
    })
    render(<MessageList messages={messages} />)

    const log = screen.getByRole("log", { name: "Messages" })
    expect(log.firstElementChild?.children).toHaveLength(messages.length)
  })

  test("opens at the latest message and only follows updates while near the bottom", () => {
    const messages = listMessages({
      sessionId: "sess-transcript",
      connectionId: "conn-local",
      projectId: "proj-hena",
    })
    const result = render(<MessageList messages={[]} />)
    const log = screen.getByRole("log", { name: "Messages" })
    Object.defineProperty(log, "scrollHeight", { configurable: true, value: 1_000 })
    Object.defineProperty(log, "clientHeight", { configurable: true, value: 400 })

    result.rerender(<MessageList messages={messages} />)
    expect(log.scrollTop).toBe(1_000)

    log.scrollTop = 200
    fireEvent.scroll(log)
    result.rerender(<MessageList messages={[...messages]} />)
    expect(log.scrollTop).toBe(200)

    log.scrollTop = 590
    fireEvent.scroll(log)
    result.rerender(<MessageList messages={[...messages]} />)
    expect(log.scrollTop).toBe(1_000)
  })
})
