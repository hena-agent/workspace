import { useState } from "react"
import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { isOneOf } from "@/lib/utils"
import { render, screen } from "@/test/test-utils"
import { SERVER_SETTINGS_SECTION_VALUES } from "./server-settings-sections"
import { ServerSettingsView, type ServerSettingsSection } from "./server-settings-view"
import type { SettingsSection } from "./settings-sections"
import { connections, mcpServers, models, providers } from "@/mock/fixtures"

function Harness({ initial }: { initial: ServerSettingsSection }) {
  const [section, setSection] = useState<SettingsSection>(initial)
  if (!isOneOf(SERVER_SETTINGS_SECTION_VALUES, section)) return null
  return (
    <ServerSettingsView
      section={section}
      onSelectSection={setSection}
      providers={providers}
      onToggleProviderConnection={() => {}}
      models={models}
      mcpServers={mcpServers}
      connections={connections}
      onRemoveConnection={() => {}}
      storage={{ usedMib: 12, budgetMib: 50 }}
      onClearCache={() => {}}
      onRemoveAllData={() => {}}
    />
  )
}

describe("ServerSettingsView", () => {
  test("switches between server-owned sections", async () => {
    const user = userEvent.setup()
    render(<Harness initial="providers" />)

    expect(screen.getByText(providers[0].name)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Models" }))
    expect(screen.getByText(models[0].name)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "MCP servers" }))
    expect(screen.getByText(mcpServers[0].name)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Server connections" }))
    expect(screen.getByText(connections[0].name)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Storage" }))
    expect(screen.getByText("12 MiB of 50 MiB")).toBeInTheDocument()
  })
})
