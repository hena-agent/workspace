import { expect, test } from "bun:test"
import { act, render, screen, waitFor } from "@testing-library/react"
import { createConnectionAgent } from "@/connection/agent"
import { MessageList } from "@/features/session/message-list"
import { useMessages } from "./queries"

test("message views use their collection scope as the session id", async () => {
  const agent = createConnectionAgent("http://hena.test")

  function View() {
    return <div>{useMessages(agent, "session-1").messages[0]?.sessionId}</div>
  }

  render(<View />)
  await act(async () => {
    agent.store.applySnapshot("messages", "session-1", [{
      key: "message-1",
      row: { id: "message-1", type: "assistant", time: { created: 1 } },
    }], 1)
    await Bun.sleep(0)
  })
  expect(await screen.findByText("session-1")).toBeVisible()
  act(() => agent.dispose())
})

test("transcript rows wait for both message and part snapshots", async () => {
  const agent = createConnectionAgent("http://hena.test")

  function View() {
    const transcript = useMessages(agent, "session-1")
    return <MessageList messages={transcript.messages} ready={transcript.ready} />
  }

  render(<View />)
  await act(async () => {
    agent.store.applySnapshot("messages", "session-1", [{
      key: "message-1",
      row: { id: "message-1", type: "user", text: "Snapshot complete", time: { created: 1 } },
    }], 1)
    await Bun.sleep(0)
  })
  expect(screen.queryByText("Snapshot complete")).not.toBeInTheDocument()

  await act(async () => {
    agent.store.applySnapshot("parts", "session-1", [], 1)
    await Bun.sleep(0)
  })
  expect(await screen.findByText("Snapshot complete")).toBeVisible()
  act(() => agent.dispose())
})

test("reasoning deltas project a provisional part before its durable row", async () => {
  const agent = createConnectionAgent("http://hena.test")

  function View() {
    return <MessageList messages={useMessages(agent, "session-1").messages} working ready />
  }

  const { container } = render(<View />)
  await act(async () => {
    agent.store.applyDelta({ sessionId: "session-1", messageId: "message-1", partId: "reasoning-1", partKind: "reasoning", offset: 0, text: "Live reasoning" })
    await Bun.sleep(0)
  })
  await waitFor(() => expect(container.querySelector('[data-slot="collapsible-content"]')).toHaveTextContent("Live reasoning"))
  expect(container.querySelector('[data-slot="collapsible-content"]')).toHaveAttribute("data-state", "open")
  expect(container.querySelector('[data-slot="collapsible-content"] [data-sd-animate]')).toBeInTheDocument()

  await act(async () => {
    agent.store.applySnapshot("messages", "session-1", [{
      key: "message-1",
      row: { id: "message-1", type: "assistant", time: { created: 1 } },
    }], 1)
    agent.store.applySnapshot("parts", "session-1", [{
      key: ["message-1", "reasoning", "reasoning-1"],
      row: { id: "reasoning-1", messageID: "message-1", ordinal: 0, type: "reasoning", text: "", time: { created: 1 } },
    }], 1)
    await Bun.sleep(0)
  })
  await waitFor(() => expect(container.querySelectorAll('[data-slot="collapsible-content"]')).toHaveLength(1))
  expect(container.querySelector('[data-slot="collapsible-content"]')).toHaveTextContent("Live reasoning")
  act(() => agent.dispose())
})
