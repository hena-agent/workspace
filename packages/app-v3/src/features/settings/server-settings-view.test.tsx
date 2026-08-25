import { describe, expect, test } from "bun:test"
import { render, screen } from "@/test/test-utils"
import { ServerSettingsView, type ServerSettingsSection } from "./server-settings-view"
import { connections, mcpServers, models, providers } from "@/test/fixtures"

function view(section: ServerSettingsSection) {
  return (
    <ServerSettingsView
      section={section}
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
  test("renders server-owned sections", () => {
    const result = render(view("providers"))

    expect(screen.getByText(providers[0].name)).toBeInTheDocument()

    result.rerender(view("models"))
    expect(screen.getByText(models[0].name)).toBeInTheDocument()

    result.rerender(view("mcp"))
    expect(screen.getByText(mcpServers[0].name)).toBeInTheDocument()

    result.rerender(view("server-connections"))
    expect(screen.getByText(connections[0].name)).toBeInTheDocument()

    result.rerender(view("storage"))
    expect(screen.getByText("12 MiB of 50 MiB")).toBeInTheDocument()
  })

  test("explains when MCP servers are unsupported", () => {
    render(
      <ServerSettingsView
        section="mcp"
        providers={[]}
        models={[]}
        mcpServers={[]}
        connections={[]}
        onRemoveConnection={() => {}}
        storage={{ usedMib: 0, budgetMib: 50 }}
      />,
    )

    expect(screen.getByText("MCP servers are not supported by this server yet.")).toBeInTheDocument()
  })
})
