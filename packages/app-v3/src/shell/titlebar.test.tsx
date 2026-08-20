import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { Titlebar } from "./titlebar"

describe("Titlebar", () => {
  test("toggles mobile and desktop navigation", async () => {
    const user = userEvent.setup()
    const called: string[] = []
    render(
      <Titlebar
        mobileNavOpen={false}
        sidebarOpen
        onToggleMobileNav={() => called.push("mobile")}
        onToggleSidebar={() => called.push("desktop")}
      />,
    )

    expect(screen.getByRole("button", { name: "Toggle menu" })).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByRole("button", { name: "Toggle sidebar" })).toHaveAttribute("aria-expanded", "true")
    await user.click(screen.getByRole("button", { name: "Toggle menu" }))
    await user.click(screen.getByRole("button", { name: "Toggle sidebar" }))
    expect(called).toEqual(["mobile", "desktop"])
  })

  test("renders optional center and right content", () => {
    render(
      <Titlebar
        mobileNavOpen={false}
        sidebarOpen={false}
        onToggleMobileNav={() => {}}
        onToggleSidebar={() => {}}
        title="Session title"
      >
        <button type="button">Action</button>
      </Titlebar>,
    )
    expect(screen.getByText("Session title")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Action" })).toBeInTheDocument()
  })
})
