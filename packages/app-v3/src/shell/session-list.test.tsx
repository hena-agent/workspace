import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { sessions } from "@/mock/fixtures"
import { render, screen } from "@/test/test-utils"
import { SessionList } from "./session-list"

describe("SessionList", () => {
  test("renders a flat list without date group headings", () => {
    render(<SessionList sessions={sessions.slice(0, 3)} onSelectSession={() => {}} onArchiveSession={() => {}} />)
    expect(screen.getByRole("navigation", { name: "Sessions" })).toBeInTheDocument()
    expect(screen.queryByText("Today")).not.toBeInTheDocument()
  })

  test("selects a session", async () => {
    const user = userEvent.setup()
    const selected: string[] = []
    render(
      <SessionList sessions={[sessions[0]]} onSelectSession={(id) => selected.push(id)} onArchiveSession={() => {}} />,
    )
    await user.click(screen.getByText(sessions[0].title))
    expect(selected).toEqual([sessions[0].id])
  })
})
