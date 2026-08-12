import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { SessionListItem } from "./session-list-item"
import type { Session } from "@/lib/types"

const baseSession: Session = {
  id: "sess-1",
  projectId: "proj-hena",
  connectionId: "conn-local",
  title: "Wire the collection stream protocol",
  status: "idle",
  unseenCount: 0,
  createdAt: 0,
  updatedAt: 0,
  archived: false,
  shared: false,
}

describe("SessionListItem", () => {
  test("clicking the title selects the session", async () => {
    const user = userEvent.setup()
    let selected = false

    render(
      <SessionListItem session={baseSession} active={false} onSelect={() => (selected = true)} onArchive={() => {}} />,
    )

    await user.click(screen.getByText(baseSession.title))
    expect(selected).toBe(true)
  })

  test("archiving does not also select the session", async () => {
    const user = userEvent.setup()
    let selected = false
    let archived = false

    render(
      <SessionListItem
        session={baseSession}
        active={false}
        onSelect={() => (selected = true)}
        onArchive={() => (archived = true)}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Archive session" }))
    expect(archived).toBe(true)
    expect(selected).toBe(false)
  })

  test("shows a working indicator for an in-progress session", () => {
    render(
      <SessionListItem
        session={{ ...baseSession, status: "working" }}
        active={false}
        onSelect={() => {}}
        onArchive={() => {}}
      />,
    )
    expect(screen.getByLabelText("Working")).toBeInTheDocument()
  })

  test("shows a shared indicator when the session is shared", () => {
    render(
      <SessionListItem
        session={{ ...baseSession, shared: true }}
        active={false}
        onSelect={() => {}}
        onArchive={() => {}}
      />,
    )
    expect(screen.getByLabelText("Shared")).toBeInTheDocument()
  })
})
