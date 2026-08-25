import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { ProvidersSection } from "./providers-section"
import { providers } from "@/test/fixtures"

describe("ProvidersSection", () => {
  test("shows Connect for a disconnected provider and Disconnect for a connected one", () => {
    render(<ProvidersSection providers={providers} onToggleConnection={() => {}} />)
    const disconnected = providers.find((p) => !p.connected)!
    const connected = providers.find((p) => p.connected)!

    expect(screen.getByRole("button", { name: `Connect ${disconnected.name}` })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: `Disconnect ${connected.name}` })).toBeInTheDocument()
  })

  test("clicking a provider's button calls onToggleConnection with its id", async () => {
    const user = userEvent.setup()
    const toggled: string[] = []

    render(<ProvidersSection providers={providers} onToggleConnection={(id) => toggled.push(id)} />)
    const label = `${providers[0].connected ? "Disconnect" : "Connect"} ${providers[0].name}`
    await user.click(screen.getByRole("button", { name: label }))

    expect(toggled).toEqual([providers[0].id])
  })
})
