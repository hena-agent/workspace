import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { SessionList } from "./session-list"
import type { Session } from "@/lib/types"

const DAY = 24 * 60 * 60 * 1000
const now = 10 * DAY

function makeSession(overrides: Partial<Session>): Session {
  return {
    id: "sess-1",
    projectId: "proj-hena",
    connectionId: "conn-local",
    title: "Untitled",
    status: "idle",
    unseenCount: 0,
    createdAt: now,
    updatedAt: now,
    archived: false,
    shared: false,
    ...overrides,
  }
}

describe("SessionList", () => {
  test("renders an empty state when there are no sessions", () => {
    render(<SessionList sessions={[]} now={now} onSelectSession={() => {}} onArchiveSession={() => {}} />)
    expect(screen.getByText("No sessions yet.")).toBeInTheDocument()
  })

  test("groups sessions into Today, Yesterday, and Older headers", () => {
    const sessions = [
      makeSession({ id: "today", title: "Today session", updatedAt: now }),
      makeSession({ id: "yesterday", title: "Yesterday session", updatedAt: now - 6 * 60 * 60 * 1000 }),
      makeSession({ id: "older", title: "Older session", updatedAt: now - 5 * DAY }),
    ]

    render(<SessionList sessions={sessions} now={now} onSelectSession={() => {}} onArchiveSession={() => {}} />)

    expect(screen.getByText("Today")).toBeInTheDocument()
    expect(screen.getByText("Yesterday")).toBeInTheDocument()
    expect(screen.getByText("Older")).toBeInTheDocument()
    expect(screen.getByText("Today session")).toBeInTheDocument()
    expect(screen.getByText("Yesterday session")).toBeInTheDocument()
    expect(screen.getByText("Older session")).toBeInTheDocument()
  })

  test("selecting a session calls onSelectSession with its id", async () => {
    const user = userEvent.setup()
    const selected: string[] = []
    const sessions = [makeSession({ id: "sess-a", title: "Session A", updatedAt: now })]

    render(
      <SessionList
        sessions={sessions}
        now={now}
        onSelectSession={(id) => selected.push(id)}
        onArchiveSession={() => {}}
      />,
    )

    await user.click(screen.getByText("Session A"))
    expect(selected).toEqual(["sess-a"])
  })
})
