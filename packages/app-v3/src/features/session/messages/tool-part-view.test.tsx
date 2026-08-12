import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { ToolPartView } from "./tool-part-view"
import type { ToolPart } from "@/lib/types"

const part: ToolPart = {
  id: "p1",
  kind: "tool",
  tool: "bash",
  status: "completed",
  input: "bun test",
  output: "3 pass",
}

describe("ToolPartView", () => {
  test("collapses the input/output until expanded", async () => {
    const user = userEvent.setup()
    render(<ToolPartView part={part} />)

    expect(screen.queryByText("3 pass")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /bash/ }))
    expect(screen.getByText("3 pass")).toBeInTheDocument()
  })

  test("labels the status icon for assistive tech", () => {
    render(<ToolPartView part={{ ...part, status: "error" }} />)
    expect(screen.getByLabelText("Error")).toBeInTheDocument()
  })
})
