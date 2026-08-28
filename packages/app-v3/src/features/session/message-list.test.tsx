import { describe, expect, test } from "bun:test"
import { render, screen } from "@/test/test-utils"
import { MessageList } from "./message-list"
import { listMessages } from "@/test/queries"

describe("MessageList", () => {
  test("shows an empty state when there are no messages", () => {
    render(<MessageList messages={[]} />)
    expect(screen.getByText("No messages yet")).toBeInTheDocument()
    expect(screen.getByText("Say something to get started.")).toBeInTheDocument()
  })

  test("renders every message in the log in order", () => {
    const messages = listMessages({
      sessionId: "sess-transcript",
      connectionId: "conn-local",
      projectId: "proj-hena",
    })
    render(<MessageList messages={messages} />)

    const log = screen.getByRole("log", { name: "Messages" })
    expect(log.querySelectorAll("[data-message-id]")).toHaveLength(messages.length)
  })

  test("marks user messages as turn anchors and exposes a latest-message control", () => {
    const messages = listMessages({
      sessionId: "sess-transcript",
      connectionId: "conn-local",
      projectId: "proj-hena",
    })
    render(<MessageList messages={messages} />)
    const log = screen.getByRole("log", { name: "Messages" })
    expect(log.querySelectorAll('[data-scroll-anchor="true"]')).toHaveLength(
      messages.filter((message) => message.role === "user").length,
    )
    expect(screen.getByRole("button", { name: "Scroll to end" })).toBeInTheDocument()
  })
})
