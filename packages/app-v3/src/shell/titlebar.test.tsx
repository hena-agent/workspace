import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { Titlebar } from "./titlebar"

describe("Titlebar", () => {
  test("the hamburger button opens the mobile nav", async () => {
    const user = userEvent.setup()
    let called = false

    render(<Titlebar onToggleMobileNav={() => (called = true)} onToggleSidebar={() => {}} sidebarOpen title="Inbox" />)

    await user.click(screen.getByRole("button", { name: "Open menu" }))
    expect(called).toBe(true)
  })

  test("the sidebar toggle reflects open state and calls its handler", async () => {
    const user = userEvent.setup()
    let called = false

    render(<Titlebar onToggleMobileNav={() => {}} onToggleSidebar={() => (called = true)} sidebarOpen title="Inbox" />)

    const toggle = screen.getByRole("button", { name: "Toggle sidebar" })
    expect(toggle).toHaveAttribute("aria-pressed", "true")
    await user.click(toggle)
    expect(called).toBe(true)
  })

  test("renders the title and right-side actions", () => {
    render(
      <Titlebar onToggleMobileNav={() => {}} onToggleSidebar={() => {}} sidebarOpen title="Inbox">
        <button type="button">Action</button>
      </Titlebar>,
    )
    expect(screen.getByText("Inbox")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Action" })).toBeInTheDocument()
  })
})
