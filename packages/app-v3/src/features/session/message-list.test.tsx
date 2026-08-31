import { describe, expect, test } from "bun:test"
import { render, screen } from "@/test/test-utils"
import { MessageList } from "./message-list"
import { listMessages } from "@/test/queries"

describe("MessageList", () => {
  test("shows an empty state when there are no messages", () => {
    render(<MessageList messages={[]} ready />)
    expect(screen.getByText("No messages yet")).toBeInTheDocument()
    expect(screen.getByText("Say something to get started.")).toBeInTheDocument()
  })

  test("does not show an empty state before messages are synchronized", () => {
    render(<MessageList messages={[]} ready={false} />)
    expect(screen.queryByText("No messages yet")).not.toBeInTheDocument()
  })

  test("does not show partial messages before their parts are synchronized", () => {
    const messages = listMessages({
      sessionId: "sess-transcript",
      connectionId: "conn-local",
      projectId: "proj-hena",
    })
    render(<MessageList messages={messages} ready={false} />)
    expect(screen.getByRole("log", { name: "Messages" }).querySelector("[data-message-id]")).toBeNull()
  })

  test("shows optimistic messages while their snapshots are synchronized", () => {
    render(<MessageList messages={[{
      id: "message-1",
      sessionId: "session-1",
      createdAt: 1,
      role: "user",
      text: "Pending prompt",
      files: [],
      pending: true,
    }]} working ready={false} />)
    expect(screen.getByText("Pending prompt")).toBeInTheDocument()
    expect(screen.getByText("You · Sending")).toBeInTheDocument()
    expect(screen.getByText("Thinking...")).toBeInTheDocument()
  })

  test("renders every message in the log in order", () => {
    const messages = listMessages({
      sessionId: "sess-transcript",
      connectionId: "conn-local",
      projectId: "proj-hena",
    })
    render(<MessageList messages={messages} ready />)

    const log = screen.getByRole("log", { name: "Messages" })
    expect(log.querySelectorAll("[data-message-id]")).toHaveLength(messages.length)
  })

  test("marks user messages as turn anchors and exposes a latest-message control", () => {
    const messages = listMessages({
      sessionId: "sess-transcript",
      connectionId: "conn-local",
      projectId: "proj-hena",
    })
    render(<MessageList messages={messages} ready />)
    const log = screen.getByRole("log", { name: "Messages" })
    expect(log.querySelectorAll('[data-scroll-anchor="true"]')).toHaveLength(
      messages.filter((message) => message.role === "user").length,
    )
    expect(screen.getByRole("button", { name: "Scroll to end" })).toBeInTheDocument()
  })
})
