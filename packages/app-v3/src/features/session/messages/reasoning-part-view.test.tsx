import { expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { ReasoningPartView } from "./reasoning-part-view"

test("blocks remote images in reasoning", () => {
  const { container } = render(<ReasoningPartView
    part={{ id: "reasoning", kind: "reasoning", text: "![remote](https://example.com/image.png)" }}
    isStreaming
  />)
  expect(container.querySelector("img")).not.toBeInTheDocument()
})

test("keeps streaming reasoning collapsed after the user closes it", async () => {
  const user = userEvent.setup()
  render(<ReasoningPartView
    part={{ id: "reasoning", kind: "reasoning", text: "Working through it" }}
    isStreaming
  />)

  const trigger = screen.getByRole("button", { name: /Thinking/ })
  expect(trigger).toHaveAttribute("aria-expanded", "true")
  await user.click(trigger)
  expect(trigger).toHaveAttribute("aria-expanded", "false")
})
