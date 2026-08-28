import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { act, render, screen } from "@/test/test-utils"
import { createConnectionStore } from "@/connection/store"
import { MessageRow } from "./message-row"
import type { SessionMessage } from "@/lib/types"

describe("MessageRow", () => {
  test("user: renders pending text and attachments", () => {
    const message: SessionMessage = { id: "m1", sessionId: "s1", createdAt: 0, role: "user", text: "Hello there", files: ["notes.txt"], pending: true }
    const { container } = render(<MessageRow message={message} />)
    expect(screen.getByText("Hello there")).toBeInTheDocument()
    expect(screen.getByText("notes.txt")).toBeInTheDocument()
    expect(screen.getByText(/Sending/)).toBeInTheDocument()
    expect(container.querySelector('[data-role="user"]')).toHaveAttribute("data-pending", "true")
  })

  test("assistant: renders the agent name and every part kind", async () => {
    const user = userEvent.setup()
    const message: SessionMessage = {
      id: "m2",
      sessionId: "s1",
      createdAt: 0,
      role: "assistant",
      agent: "build",
      model: "sonnet",
      parts: [
        { id: "p1", kind: "text", text: "Here is the answer." },
        { id: "p2", kind: "reasoning", text: "Thinking about it." },
        { id: "p3", kind: "tool", tool: "read", status: "completed", input: "file.ts" },
        { id: "p4", kind: "unknown", type: "future-part", summary: "Still visible." },
      ],
    }
    render(<MessageRow message={message} />)
    expect(screen.getByText("build")).toBeInTheDocument()
    expect(screen.getByText(/sonnet/)).toBeInTheDocument()
    expect(screen.getByText("Here is the answer.")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /Thought for a few seconds/ }))
    expect(screen.getByText("Thinking about it.")).toBeVisible()
    expect(screen.getByRole("button", { name: /read file.ts/ })).toBeInTheDocument()
    expect(screen.getByText(/Unsupported part: future-part/)).toBeInTheDocument()
    expect(screen.getByText(/Still visible/)).toBeInTheDocument()
  })

  test("assistant: opens the latest reasoning part while working", () => {
    const message: SessionMessage = {
      id: "m-reasoning",
      sessionId: "s1",
      createdAt: 0,
      role: "assistant",
      parts: [{ id: "p-reasoning", kind: "reasoning", text: "Checking the implementation." }],
    }

    const { container } = render(<MessageRow message={message} working />)
    expect(screen.getByText("Thinking...")).toBeVisible()
    expect(container.querySelector('[data-slot="collapsible-content"]')).toHaveTextContent("Checking the implementation.")
    expect(container.querySelector('[data-sd-animate]')).toBeInTheDocument()
  })

  test("assistant: renders live reasoning ahead of the persisted part", () => {
    const listeners = new Set<() => void>()
    let text = "First reasoning chunk"
    const message: SessionMessage = {
      id: "m-live-reasoning",
      sessionId: "s1",
      createdAt: 0,
      role: "assistant",
      parts: [{
        id: "p-live-reasoning",
        kind: "reasoning",
        text: "Stale persisted reasoning",
        live: {
          subscribe: (listener) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
          },
          snapshot: () => text,
          incomplete: () => false,
        },
      }],
    }

    const { container } = render(<MessageRow message={message} working />)
    expect(container.querySelector('[data-slot="collapsible-content"]')).toHaveTextContent("First reasoning chunk")
    expect(screen.queryByText("Stale persisted reasoning")).not.toBeInTheDocument()
    act(() => {
      text = "Second reasoning chunk"
      listeners.forEach((listener) => listener())
    })
    expect(container.querySelector('[data-slot="collapsible-content"]')).toHaveTextContent("Second reasoning chunk")
  })

  test("assistant: streams text and reasoning through the connection store", () => {
    const frames: Array<() => void> = []
    const store = createConnectionStore({ scheduleFrame: (callback) => frames.push(callback) })
    const textIdentity = { sessionId: "s1", messageId: "m-store-text", partId: "p-text", partKind: "text" as const }
    const reasoningIdentity = { sessionId: "s1", messageId: "m-store-reasoning", partId: "p-reasoning", partKind: "reasoning" as const }
    const live = (identity: typeof textIdentity | typeof reasoningIdentity) => ({
      subscribe: (listener: () => void) => store.subscribeDelta(identity, listener),
      snapshot: () => store.delta(identity)?.text ?? "",
      incomplete: () => store.delta(identity)?.incomplete ?? false,
    })
    const textMessage: SessionMessage = {
      id: "m-store-text",
      sessionId: "s1",
      createdAt: 0,
      role: "assistant",
      parts: [{ id: "p-text", kind: "text", text: "", live: live(textIdentity) }],
    }
    const reasoningMessage: SessionMessage = {
      id: "m-store-reasoning",
      sessionId: "s1",
      createdAt: 1,
      role: "assistant",
      parts: [{ id: "p-reasoning", kind: "reasoning", text: "", live: live(reasoningIdentity) }],
    }

    const { container } = render(<><MessageRow message={textMessage} working /><MessageRow message={reasoningMessage} working /></>)
    act(() => {
      store.applyDelta({ ...reasoningIdentity, offset: 0, text: "Live reasoning tokens" })
      store.applyDelta({ ...textIdentity, offset: 0, text: "First response chunk" })
      frames.shift()?.()
    })
    expect(container).toHaveTextContent("Live reasoning tokens")
    expect(container).toHaveTextContent("First response chunk")
    expect(container.querySelector('[data-sd-animate]')).toBeInTheDocument()

    store.applyRows({
      throughSeq: 1,
      changes: [
        { seq: 1, collection: "parts", scopeKey: "s1", rowKey: ["m-store-reasoning", "reasoning", "p-reasoning"], op: "insert", row: { type: "reasoning", text: "", time: { created: 1 } } },
        { seq: 1, collection: "parts", scopeKey: "s1", rowKey: ["m-store-text", "text", "p-text"], op: "insert", row: { type: "text", text: "" } },
      ],
    })
    act(() => {
      store.applyDelta({ ...reasoningIdentity, offset: 21, text: " continue" })
      store.applyDelta({ ...textIdentity, offset: 20, text: " plus another" })
      frames.shift()?.()
    })
    expect(container).toHaveTextContent("Live reasoning tokens continue")
    expect(container).toHaveTextContent("First response chunk plus another")
  })

  test("assistant: updates live text without replacing SessionMessage", () => {
    const listeners = new Set<() => void>()
    let text = "First chunk"
    const message: SessionMessage = {
      id: "m-live",
      sessionId: "s1",
      createdAt: 0,
      role: "assistant",
      parts: [{
        id: "p-live",
        kind: "text",
        text: "Stale persisted text",
        live: {
          subscribe: (listener) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
          },
          snapshot: () => text,
          incomplete: () => false,
        },
      }],
    }

    const { container } = render(<MessageRow message={message} working />)
    expect(container).toHaveTextContent("First chunk")
    expect(screen.queryByText("Stale persisted text")).not.toBeInTheDocument()
    act(() => {
      text = "Second chunk"
      listeners.forEach((listener) => listener())
    })
    expect(container).toHaveTextContent("Second chunk")
  })

  test("assistant: renders Markdown but blocks remote images", () => {
    const message: SessionMessage = {
      id: "m-markdown",
      sessionId: "s1",
      createdAt: 0,
      role: "assistant",
      parts: [{ id: "p-markdown", kind: "text", text: "## Release notes\n\n![remote](https://example.com/image.png)" }],
    }

    const { container } = render(<MessageRow message={message} />)
    expect(screen.getByRole("heading", { name: "Release notes" })).toBeInTheDocument()
    expect(container.querySelector("img")).not.toBeInTheDocument()
  })

  test("compaction: renders the summary and an in-progress marker when not final", () => {
    const message: SessionMessage = {
      id: "m3",
      sessionId: "s1",
      createdAt: 0,
      role: "compaction",
      summary: "Summed up.",
      final: false,
    }
    render(<MessageRow message={message} />)
    expect(screen.getByText("Summed up.", { exact: false })).toBeInTheDocument()
    expect(screen.getByText("summarizing…")).toBeInTheDocument()
  })

  test("shell: renders the command and lazy terminal output", async () => {
    const message: SessionMessage = {
      id: "m4",
      sessionId: "s1",
      createdAt: 0,
      role: "shell",
      command: "bun test",
      output: "3 pass",
    }
    render(<MessageRow message={message} />)
    expect(screen.getByText("bun test")).toBeInTheDocument()
    expect(await screen.findByLabelText("Shell output")).toHaveTextContent("3 pass")
  })

  test("system and synthetic: render their text and a distinct data-role", () => {
    const system: SessionMessage = {
      id: "m5",
      sessionId: "s1",
      createdAt: 0,
      role: "system",
      text: "Context refreshed.",
    }
    const synthetic: SessionMessage = {
      id: "m6",
      sessionId: "s1",
      createdAt: 0,
      role: "synthetic",
      text: "Reminder injected.",
    }

    const { container: systemContainer } = render(<MessageRow message={system} />)
    expect(systemContainer.querySelector('[data-role="system"]')).toBeInTheDocument()

    const { container: syntheticContainer } = render(<MessageRow message={synthetic} />)
    expect(syntheticContainer.querySelector('[data-role="synthetic"]')).toBeInTheDocument()
  })

  test("agent-switched and model-switched: render from/to", () => {
    const agentSwitch: SessionMessage = {
      id: "m7",
      sessionId: "s1",
      createdAt: 0,
      role: "agent-switched",
      from: "plan",
      to: "build",
    }
    const modelSwitch: SessionMessage = {
      id: "m8",
      sessionId: "s1",
      createdAt: 0,
      role: "model-switched",
      from: "opus",
      to: "sonnet",
    }

    render(<MessageRow message={agentSwitch} />)
    expect(screen.getByText(/plan/)).toBeInTheDocument()
    expect(screen.getByText(/build/)).toBeInTheDocument()

    render(<MessageRow message={modelSwitch} />)
    expect(screen.getByText(/opus/)).toBeInTheDocument()
    expect(screen.getByText(/sonnet/)).toBeInTheDocument()
  })
})
