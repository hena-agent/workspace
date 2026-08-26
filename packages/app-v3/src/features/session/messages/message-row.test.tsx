import { describe, expect, test } from "bun:test"
import { render, screen } from "@/test/test-utils"
import { MessageRow } from "./message-row"
import type { SessionMessage } from "@/lib/types"

describe("MessageRow", () => {
  test("user: renders the message text", () => {
    const message: SessionMessage = { id: "m1", sessionId: "s1", createdAt: 0, role: "user", text: "Hello there" }
    render(<MessageRow message={message} />)
    expect(screen.getByText("Hello there")).toBeInTheDocument()
  })

  test("assistant: renders the agent name and every part kind", () => {
    const message: SessionMessage = {
      id: "m2",
      sessionId: "s1",
      createdAt: 0,
      role: "assistant",
      agent: "build",
      parts: [
        { id: "p1", kind: "text", text: "Here is the answer." },
        { id: "p2", kind: "reasoning", text: "Thinking about it." },
        { id: "p3", kind: "tool", tool: "read", status: "completed", input: "file.ts" },
      ],
    }
    render(<MessageRow message={message} />)
    expect(screen.getByText("build")).toBeInTheDocument()
    expect(screen.getByText("Here is the answer.")).toBeInTheDocument()
    expect(screen.getByText("Thinking")).toBeInTheDocument()
    expect(screen.getByText("read")).toBeInTheDocument()
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

  test("shell: renders the command and output", () => {
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
    expect(screen.getByText("3 pass")).toBeInTheDocument()
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
