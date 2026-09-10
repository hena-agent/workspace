import { expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { ReasoningPartView } from "./reasoning-part-view"

test.each(["", " \n\t "])("hides finished reasoning with no visible text (%j)", (text) => {
  expect(render(<ReasoningPartView part={{ id: "reasoning", kind: "reasoning", text }} />).container).toBeEmptyDOMElement()
  expect(screen.queryByRole("button")).not.toBeInTheDocument()
})

test("keeps empty reasoning visible only while streaming", () => {
  const part = { id: "reasoning", kind: "reasoning" as const, text: "" }
  const view = render(<ReasoningPartView part={part} isStreaming />)
  expect(screen.getByRole("button", { name: /Thinking/ })).toBeVisible()

  view.rerender(<ReasoningPartView part={part} isStreaming={false} />)
  expect(view.container).toBeEmptyDOMElement()
})

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
