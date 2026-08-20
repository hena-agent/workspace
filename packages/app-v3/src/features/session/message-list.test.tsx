import { describe, expect, test } from "bun:test"
import { render, screen } from "@/test/test-utils"
import { MessageList } from "./message-list"
import { listMessages } from "@/mock/queries"

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
    expect(log.children).toHaveLength(messages.length)
  })
})
