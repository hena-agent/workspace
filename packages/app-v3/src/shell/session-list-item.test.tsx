import { describe, expect, test } from "bun:test"
import { render, screen } from "@testing-library/react"
import type { Session } from "@/lib/types"
import { SessionListItem } from "./session-list-item"

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    projectId: "project-1",
    connectionId: "conn-1",
    title: "A session",
    status: "idle",
    unread: false,
    createdAt: 0,
    updatedAt: 0,
    archived: false,
    shared: false,
    ...overrides,
  }
}

function noop() {}

describe("SessionListItem", () => {
  test("shows the unread dot for an unread, idle session", () => {
    render(<SessionListItem session={session({ unread: true })} active={false} mobile={false} onSelect={noop} />)
    expect(screen.getByLabelText("Unread")).toBeInTheDocument()
  })

  test("hides the unread dot once the session is read", () => {
    render(<SessionListItem session={session({ unread: false })} active={false} mobile={false} onSelect={noop} />)
    expect(screen.queryByLabelText("Unread")).not.toBeInTheDocument()
  })

  test("prefers the working spinner over the unread dot", () => {
    render(<SessionListItem session={session({ unread: true, status: "working" })} active={false} mobile={false} onSelect={noop} />)
    expect(screen.queryByLabelText("Unread")).not.toBeInTheDocument()
    expect(screen.getByLabelText("Working")).toBeInTheDocument()
  })
})
