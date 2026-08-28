import { describe, expect, mock, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
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
    expect(screen.getByText("Result").parentElement).toHaveTextContent("3 pass")
  })

  test.each([
    ["pending", "input-streaming", "Pending"],
    ["running", "input-available", "Running"],
    ["completed", "output-available", "Completed"],
    ["error", "output-error", "Error"],
  ] as const)("maps %s to %s", (status, state, label) => {
    const { container } = render(<ToolPartView part={{ ...part, status }} />)
    expect(container.querySelector(`[data-tool-state="${state}"]`)).toBeInTheDocument()
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  test("keeps input and duration in the collapsed summary", () => {
    render(<ToolPartView part={{ ...part, durationMs: 42 }} />)
    expect(screen.getByRole("button", { name: /bash bun test · 42ms/ })).toBeInTheDocument()
  })

  test("loads paged output only when requested", async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const loadPage = mock(async (offset: number) => offset === 0
      ? { text: "full ", offset: 0, nextOffset: 5, totalBytes: 11, revision: "r1" }
      : { text: "output", offset: 5, nextOffset: 11, totalBytes: 11, revision: "r1" })
    render(<ToolPartView part={{
      ...part,
      output: "preview",
      outputContent: { id: "c1", revision: "r1", bytes: 11, queryKey: ["c1", "r1"], loadPage },
    }} />, { wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider> })

    expect(loadPage).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: /bash/ }))
    expect(screen.getByText("preview")).toBeInTheDocument()
    expect(loadPage).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Show full output (11 bytes)" }))
    expect(await screen.findByText("full output")).toBeInTheDocument()
    expect(loadPage).toHaveBeenCalledTimes(2)
  })
})
