import { describe, expect, test } from "bun:test"
import { render, screen, waitFor } from "@/test/test-utils"
import { MessageList } from "./message-list"
import { listMessages } from "@/test/queries"

function transcript(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${index}`,
    sessionId: "session-1",
    createdAt: index,
    role: "user" as const,
    text: `Message ${index}`,
    files: [],
  }))
}

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

  test("streams a transcript longer than the first bounded commit into the log", async () => {
    const messages = transcript(60)
    render(<MessageList messages={messages} ready />)

    const log = screen.getByRole("log", { name: "Messages" })
    await waitFor(() => expect(log.querySelectorAll("[data-message-id]")).toHaveLength(messages.length))
    expect(Array.from(log.querySelectorAll("[data-message-id]"), (node) => node.getAttribute("data-message-id")))
      .toEqual(messages.map((message) => message.id))
  })

  test("keeps rendered history mounted when a message arrives during streaming", async () => {
    const view = render(<MessageList messages={transcript(60)} working ready />)
    const log = screen.getByRole("log", { name: "Messages" })
    await waitFor(() => expect(log.querySelectorAll("[data-message-id]")).toHaveLength(60))

    const unmounted: string[] = []
    new MutationObserver((records) => records.forEach((record) => record.removedNodes.forEach((node) => {
      const element = node as HTMLElement
      const id = element.getAttribute?.("data-message-id")
        ?? element.querySelector?.("[data-message-id]")?.getAttribute("data-message-id")
      if (id) unmounted.push(id)
    }))).observe(log, { childList: true, subtree: true })

    view.rerender(<MessageList messages={transcript(61)} working ready />)
    await waitFor(() => expect(log.querySelectorAll("[data-message-id]")).toHaveLength(61))
    expect(unmounted).toEqual([])
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
