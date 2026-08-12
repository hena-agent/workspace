import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { PermissionDock } from "./permission-dock"
import type { PermissionRequest } from "@/lib/types"

const request: PermissionRequest = {
  id: "perm-1",
  sessionId: "s1",
  title: "Run secret-rotation script",
  description: "Writes to the shared credentials store.",
  createdAt: 0,
}

describe("PermissionDock", () => {
  test.each([
    ["Deny", "onDeny"],
    ["Allow once", "onAllowOnce"],
    ["Always allow", "onAllowAlways"],
  ] as const)("%s calls %s", async (label) => {
    const user = userEvent.setup()
    const calls = { onDeny: 0, onAllowOnce: 0, onAllowAlways: 0 }

    render(
      <PermissionDock
        request={request}
        onDeny={() => calls.onDeny++}
        onAllowOnce={() => calls.onAllowOnce++}
        onAllowAlways={() => calls.onAllowAlways++}
      />,
    )

    await user.click(screen.getByRole("button", { name: label }))
    expect(Object.values(calls).reduce((a, b) => a + b, 0)).toBe(1)
  })

  test("renders the request title and description", () => {
    render(<PermissionDock request={request} onDeny={() => {}} onAllowOnce={() => {}} onAllowAlways={() => {}} />)
    expect(screen.getByText(request.title)).toBeInTheDocument()
    expect(screen.getByText(request.description)).toBeInTheDocument()
  })
})
