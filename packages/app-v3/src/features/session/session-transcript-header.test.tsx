import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { SessionTranscriptHeader } from "./session-transcript-header"
import { sessions } from "@/mock/fixtures"

const session = sessions[0]

describe("SessionTranscriptHeader", () => {
  test("renders the session title", () => {
    render(<SessionTranscriptHeader session={session} onShare={() => {}} onFork={() => {}} onArchive={() => {}} />)
    expect(screen.getByRole("heading", { name: session.title })).toBeInTheDocument()
  })

  test("the menu exposes share, fork, and archive", async () => {
    const user = userEvent.setup()
    let shared = false
    let forked = false
    let archived = false

    render(
      <SessionTranscriptHeader
        session={session}
        onShare={() => (shared = true)}
        onFork={() => (forked = true)}
        onArchive={() => (archived = true)}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Session actions" }))
    await user.click(await screen.findByText("Share"))
    expect(shared).toBe(true)

    await user.click(screen.getByRole("button", { name: "Session actions" }))
    await user.click(await screen.findByText("Fork"))
    expect(forked).toBe(true)

    await user.click(screen.getByRole("button", { name: "Session actions" }))
    await user.click(await screen.findByText("Archive"))
    expect(archived).toBe(true)
  })
})
