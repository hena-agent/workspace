import { expect, test } from "bun:test"
import { render } from "@testing-library/react"
import { ReasoningPartView } from "./reasoning-part-view"

test("blocks remote images in reasoning", () => {
  const { container } = render(<ReasoningPartView
    part={{ id: "reasoning", kind: "reasoning", text: "![remote](https://example.com/image.png)" }}
    isStreaming
  />)
  expect(container.querySelector("img")).not.toBeInTheDocument()
})
