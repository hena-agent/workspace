import { expect, test } from "bun:test"
import { act, render, renderHook, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { flushSync } from "react-dom"
import userEvent from "@testing-library/user-event"
import { createConnectionAgent } from "@/connection/agent"
import { MessageList } from "@/features/session/message-list"
import { useCatalog, useLocationCatalog, useMessages, useSessions } from "./queries"

test("both catalog paths exclude hidden agents and subagents but retain visible custom agents", async () => {
  const location = { directory: "/project" }
  const agents = [
    { id: "build", mode: "primary", hidden: false },
    { id: "plan", mode: "primary", hidden: false },
    { id: "general", mode: "subagent", hidden: false },
    { id: "explore", mode: "subagent", hidden: false },
    { id: "compaction", mode: "primary", hidden: true },
    { id: "title", mode: "primary", hidden: true },
    { id: "summary", mode: "primary", hidden: true },
    { id: "review", mode: "all", hidden: false },
    { id: "custom", mode: "primary", hidden: false },
    { id: "hidden-custom", mode: "all", hidden: true },
    { id: "", mode: "primary", hidden: false },
  ]
  const agent = createConnectionAgent("http://hena.test", async () => Response.json({ agents, models: [], providers: [] }))
  agent.store.applySnapshot("agents", JSON.stringify(location), agents.map((row) => ({ key: row.id, row })), 1)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = renderHook(() => ({
    synced: useCatalog(agent, location),
    fetched: useLocationCatalog(agent, location),
  }), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })

  await waitFor(() => expect(view.result.current.fetched.isSuccess).toBe(true))
  const expected = ["build", "custom", "plan", "review"]
  expect(view.result.current.synced.agents.map((item) => item.id).sort()).toEqual(expected)
  expect(view.result.current.fetched.data?.agents.map((item) => item.id).sort()).toEqual(expected)
  expect(view.result.current.synced.agents.find((item) => item.id === "build")).toEqual({ id: "build", name: "build", description: "" })
  expect(view.result.current.fetched.data?.agents.toSorted((a, b) => a.id.localeCompare(b.id)))
    .toEqual(view.result.current.synced.agents.toSorted((a, b) => a.id.localeCompare(b.id)))
  view.unmount()
  client.clear()
  act(() => agent.dispose())
})

test("a session is unread until its read watermark catches up to its update time", async () => {
  const agent = createConnectionAgent("http://hena.test")
  agent.store.applySnapshot("sessions", "", [{
    key: "session-1",
    row: { id: "session-1", projectID: "project-1", title: "Unread session", time: { created: 1, updated: 10 } },
  }], 1)

  function View() {
    const session = useSessions(agent).find((item) => item.id === "session-1")
    return <div>{session?.unread ? "unread" : "read"}</div>
  }

  render(<View />)
  expect(await screen.findByText("unread")).toBeVisible()

  await act(async () => {
    agent.store.applySnapshot("sessions", "", [{
      key: "session-1",
      row: { id: "session-1", projectID: "project-1", title: "Unread session", time: { created: 1, updated: 10 }, read: 10 },
    }], 2)
    await Bun.sleep(0)
  })
  expect(await screen.findByText("read")).toBeVisible()
  act(() => agent.dispose())
})

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
    agent.store.applySnapshot("parts", "session-1", [], 1)
    await Bun.sleep(0)
  })
  expect(await screen.findByText("session-1")).toBeVisible()
  act(() => agent.dispose())
})

test("server tool rows display their name, execution duration, and text output", async () => {
  const user = userEvent.setup()
  const agent = createConnectionAgent("http://hena.test")
  agent.store.applySnapshot("messages", "session-1", [{
    key: "message-1",
    row: { id: "message-1", type: "assistant", time: { created: 1 } },
  }], 1)
  agent.store.applySnapshot("parts", "session-1", [{
    key: ["message-1", "tool", "tool-1"],
    row: {
      id: "tool-1", messageID: "message-1", ordinal: 0, type: "tool", name: "bash",
      state: {
        status: "completed", input: { command: "bun test" }, structured: {},
        content: [{ type: "text", text: "3 pass" }, { type: "text", text: "0 fail" }],
        result: "Result fallback should not replace text content",
      },
      time: { created: 1, ran: 2, completed: 44 },
    },
  }], 1)

  function View() {
    const transcript = useMessages(agent, "session-1")
    return <MessageList messages={transcript.messages} ready={transcript.ready} />
  }

  render(<View />)
  await user.click(await screen.findByRole("button", { name: /bash.*bun test.*42ms/ }))
  expect(screen.getByText("Result").parentElement).toHaveTextContent("3 pass")
  expect(screen.getByText("Result").parentElement).toHaveTextContent("0 fail")
  expect(screen.queryByText("Result fallback should not replace text content")).not.toBeInTheDocument()
  act(() => agent.dispose())
})

test.each([
  { status: "completed", result: { passed: 3 }, error: undefined, time: { created: 0, completed: 42 }, output: '"passed":3', duration: "42ms" },
  { status: "error", result: undefined, error: { type: "unknown", message: "Command could not start" }, time: { created: 1, completed: 1 }, output: "Command could not start", duration: "0ms" },
  { status: "error", result: undefined, error: { type: "unknown", message: "Command failed after output" }, content: [{ type: "text", text: "partial stdout" }], time: { created: 1, ran: 10, completed: 9 }, output: "partial stdout", duration: "0ms" },
  { status: "running", result: undefined, error: undefined, time: { created: 1, ran: 2 }, output: undefined, duration: undefined },
])("tool output falls back to result or error and duration requires completion: $status", async (item) => {
  const user = userEvent.setup()
  const agent = createConnectionAgent("http://hena.test")
  agent.store.applySnapshot("messages", "session-1", [{ key: "message-1", row: { id: "message-1", type: "assistant", time: { created: 1 } } }], 1)
  agent.store.applySnapshot("parts", "session-1", [{
    key: ["message-1", "tool", "tool-1"],
    row: {
      id: "tool-1", messageID: "message-1", ordinal: 0, type: "tool", name: "bash",
      state: { status: item.status, input: { command: "bun test" }, structured: {}, content: item.content ?? [], result: item.result, error: item.error }, time: item.time,
    },
  }], 1)
  function View() {
    const transcript = useMessages(agent, "session-1")
    return <MessageList messages={transcript.messages} ready={transcript.ready} />
  }
  render(<View />)
  const header = await screen.findByRole("button", { name: /bash/ })
  if (item.duration) expect(header).toHaveTextContent(item.duration)
  if (!item.duration) expect(header).not.toHaveTextContent("ms")
  await user.click(header)
  if (item.output) expect(screen.getByRole("heading", { name: item.status === "error" ? "Error" : "Result" }).parentElement).toHaveTextContent(item.output)
  if (item.error) expect(screen.getByRole("heading", { name: "Error" }).parentElement).toHaveTextContent(item.error.message)
  if (!item.output) expect(screen.queryByRole("heading", { name: "Result" })).not.toBeInTheDocument()
  act(() => agent.dispose())
})

test("tool text pages load on demand without replacing sibling output", async () => {
  const user = userEvent.setup()
  const requests: string[] = []
  const agent = createConnectionAgent("http://hena.test", async (input) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    requests.push(url.pathname)
    expect(url.searchParams.get("sessionID")).toBe("session-1")
    expect(url.searchParams.get("revision")).toBe("r1")
    return Response.json({ text: "full output", offset: 0, nextOffset: 11, totalBytes: 11, revision: "r1" })
  })
  agent.store.applySnapshot("messages", "session-1", [{ key: "message-1", row: { id: "message-1", type: "assistant", time: { created: 1 } } }], 1)
  agent.store.applySnapshot("parts", "session-1", [{
    key: ["message-1", "tool", "tool-1"],
    row: {
      id: "tool-1", messageID: "message-1", ordinal: 0, type: "tool", name: "bash",
      state: {
        status: "completed", input: {}, structured: {},
        content: [
          { type: "text", text: "before output" },
          { type: "text", text: "preview", truncated: true, content: { id: "c1", revision: "r1", bytes: 11 } },
          { type: "text", text: "after output" },
        ],
        result: { truncated: true, content: { id: "unused-result", revision: "r1", bytes: 100 } },
      },
      time: { created: 1, ran: 2, completed: 44 },
    },
  }], 1)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function View() {
    const transcript = useMessages(agent, "session-1")
    return <MessageList messages={transcript.messages} ready={transcript.ready} />
  }
  const view = render(<QueryClientProvider client={client}><View /></QueryClientProvider>)
  await user.click(await screen.findByRole("button", { name: /bash/ }))
  expect(requests).toEqual([])
  expect(screen.getByText("Result").parentElement).toHaveTextContent("preview")
  await user.click(screen.getByRole("button", { name: "Show full output (11 bytes)" }))
  expect(await screen.findByText("full output")).toBeVisible()
  expect(screen.getByText("Result").parentElement).toHaveTextContent("before output")
  expect(screen.getByText("Result").parentElement).toHaveTextContent("after output")
  expect(requests).toEqual(["/api/content/c1"])
  view.unmount()
  client.clear()
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
  expect(agent.store.transcript("session-1").toArray).toEqual([])

  await act(async () => {
    agent.store.applySnapshot("parts", "session-1", [], 1)
    await Bun.sleep(0)
  })
  expect(await screen.findByText("Snapshot complete")).toBeVisible()
  act(() => agent.dispose())
})

test.each([
  { error: { type: "unknown", message: "MissingSessionID: OpenCode's free tier can only be used in OpenCode" }, text: "MissingSessionID" },
  { error: { type: "unknown" }, text: "Unknown provider error" },
])("assistant failures remain visible even when the provider returned no parts: $text", async ({ error, text }) => {
  const agent = createConnectionAgent("http://hena.test")

  function View() {
    const transcript = useMessages(agent, "session-1")
    return <MessageList messages={transcript.messages} ready={transcript.ready} />
  }

  render(<View />)
  await act(async () => {
    agent.store.applySnapshot("messages", "session-1", [{
      key: "message-1",
      row: {
        id: "message-1",
        type: "assistant",
        time: { created: 1, completed: 2 },
        error,
      },
    }], 1)
    agent.store.applySnapshot("parts", "session-1", [], 1)
    await Bun.sleep(0)
  })
  expect(await screen.findByRole("alert")).toHaveTextContent(text)
  act(() => agent.dispose())
})

test("persisted interruptions render as stopped responses without an error or thinking indicator", async () => {
  const agent = createConnectionAgent("http://hena.test")

  function View() {
    const transcript = useMessages(agent, "session-1")
    // The session's working flag can lag behind the terminal message update.
    return <MessageList messages={transcript.messages} ready={transcript.ready} working />
  }

  render(<View />)
  await act(async () => {
    agent.store.applySnapshot("messages", "session-1", [{
      key: "message-1",
      row: {
        id: "message-1",
        type: "assistant",
        time: { created: 1, completed: 2 },
        error: { type: "unknown", message: "Provider turn interrupted" },
      },
    }], 1)
    agent.store.applySnapshot("parts", "session-1", [], 1)
    await Bun.sleep(0)
  })
  expect(await screen.findByRole("status")).toHaveTextContent("Response stopped")
  expect(screen.queryByRole("alert")).toBeNull()
  expect(screen.queryByText("Thinking...")).toBeNull()
  act(() => agent.dispose())
})

test("empty transcripts return to a busy state while resynchronizing", async () => {
  const agent = createConnectionAgent("http://hena.test")
  agent.store.applySnapshot("messages", "session-1", [], 1)
  agent.store.applySnapshot("parts", "session-1", [], 1)

  function View() {
    const transcript = useMessages(agent, "session-1")
    return <MessageList messages={transcript.messages} ready={transcript.ready} />
  }

  render(<View />)
  expect(await screen.findByText("No messages yet")).toBeVisible()

  act(() => agent.store.resetCursors([
    { collection: "messages", scopeKey: "session-1" },
    { collection: "parts", scopeKey: "session-1" },
  ]))

  await waitFor(() => expect(screen.queryByText("No messages yet")).toBeNull())
  expect(screen.getByRole("log", { name: "Messages" })).toHaveAttribute("aria-busy", "true")
  act(() => agent.dispose())
})

test("paired snapshot publication keeps the previous live-query transcript until both commits", async () => {
  const agent = createConnectionAgent("http://hena.test")
  agent.store.applySnapshot("messages", "session-1", [{
    key: "message-1",
    row: { id: "message-1", type: "user", text: "Old transcript", time: { created: 1 } },
  }], 1)
  agent.store.applySnapshot("parts", "session-1", [], 1)

  function View() {
    const transcript = useMessages(agent, "session-1")
    return <MessageList messages={transcript.messages} ready={transcript.ready} />
  }

  render(<View />)
  expect(await screen.findByText("Old transcript")).toBeVisible()
  act(() => agent.store.batch(() => {
    flushSync(() => agent.store.applySnapshot("messages", "session-1", [{
      key: "message-2",
      row: { id: "message-2", type: "user", text: "New transcript", time: { created: 2 } },
    }], 2))
    expect(screen.getByText("Old transcript")).toBeVisible()
    expect(screen.queryByText("New transcript")).toBeNull()
    agent.store.applySnapshot("parts", "session-1", [], 2)
  }))
  expect(await screen.findByText("New transcript")).toBeVisible()
  expect(screen.queryByText("Old transcript")).toBeNull()
  act(() => agent.dispose())
})

test("local prompts remain visible until both authoritative snapshots complete", async () => {
  const agent = createConnectionAgent("http://hena.test")
  agent.localMessages.stage("session-1", "message-1", {
    id: "message-1",
    type: "user",
    text: "Local prompt",
    time: { created: 1 },
  })

  function View() {
    const transcript = useMessages(agent, "session-1")
    return <MessageList messages={transcript.messages} ready={transcript.ready} />
  }

  render(<View />)
  await act(async () => {
    agent.store.applySnapshot("messages", "session-1", [{
      key: "message-1",
      row: { id: "message-1", type: "user", text: "Local prompt", time: { created: 1 } },
    }], 1)
    await Bun.sleep(0)
  })
  expect(await screen.findByText("Local prompt")).toBeVisible()
  expect(agent.localMessages.rows("session-1")).toHaveLength(1)

  await act(async () => {
    agent.store.applySnapshot("parts", "session-1", [], 1)
    await Bun.sleep(0)
  })
  expect(screen.getByText("Local prompt")).toBeVisible()
  expect(agent.localMessages.rows("session-1")).toEqual([])
  act(() => agent.dispose())
})

test("local prompt changes notify transcript consumers directly", async () => {
  const agent = createConnectionAgent("http://hena.test")
  agent.store.applySnapshot("messages", "session-1", [], 1)
  agent.store.applySnapshot("parts", "session-1", [], 1)

  function View() {
    const transcript = useMessages(agent, "session-1")
    return <MessageList messages={transcript.messages} ready={transcript.ready} />
  }

  render(<View />)
  act(() => agent.localMessages.stage("session-1", "message-1", {
    id: "message-1",
    type: "user",
    text: "Direct local prompt",
    time: { created: 1 },
  }))
  expect(await screen.findByText("Direct local prompt")).toBeVisible()

  act(() => agent.localMessages.drop("session-1", "message-1"))
  await waitFor(() => expect(screen.queryByText("Direct local prompt")).toBeNull())
  act(() => agent.dispose())
})

test("reasoning deltas project a provisional part before its durable row", async () => {
  const agent = createConnectionAgent("http://hena.test")
  agent.store.applySnapshot("messages", "session-1", [], 0)
  agent.store.applySnapshot("parts", "session-1", [], 0)

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

  act(() => agent.store.resetCursors([
    { collection: "messages", scopeKey: "session-1" },
    { collection: "parts", scopeKey: "session-1" },
  ]))
  await waitFor(() => expect(container.querySelector('[data-slot="collapsible-content"]')).toBeNull())

  await act(async () => {
    agent.store.applyDelta({ sessionId: "session-1", messageId: "message-1", partId: "reasoning-1", partKind: "reasoning", offset: 0, text: "Live reasoning" })
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
