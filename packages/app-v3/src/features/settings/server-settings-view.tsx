import type { Connection, McpServer, Model, Provider } from "@/lib/types"
import { McpSection } from "./mcp-section"
import { ModelsSection } from "./models-section"
import { ProvidersSection } from "./providers-section"
import { SERVER_SETTINGS_SECTIONS, type ServerSettingsSection } from "./server-settings-sections"
import { ServersSection } from "./servers-section"
import { SettingsNav } from "./settings-nav"

export type { ServerSettingsSection } from "./server-settings-sections"

export function ServerSettingsView({
  section,
  onSelectSection,
  providers,
  onToggleProviderConnection,
  models,
  mcpServers,
  connections,
  onRemoveConnection,
}: {
  section: ServerSettingsSection
  onSelectSection: (section: ServerSettingsSection) => void
  providers: Provider[]
  onToggleProviderConnection: (providerId: string) => void
  models: Model[]
  mcpServers: McpServer[]
  connections: Connection[]
  onRemoveConnection: (connectionId: string) => void
}) {
  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-4 md:flex-row md:p-6">
      <SettingsNav sections={SERVER_SETTINGS_SECTIONS} active={section} onSelect={onSelectSection} />
      <div className="min-w-0 flex-1">
        {section === "providers" ? (
          <ProvidersSection providers={providers} onToggleConnection={onToggleProviderConnection} />
        ) : null}
        {section === "models" ? <ModelsSection models={models} providers={providers} /> : null}
        {section === "mcp" ? <McpSection servers={mcpServers} /> : null}
        {section === "servers" ? <ServersSection connections={connections} onRemove={onRemoveConnection} /> : null}
      </div>
    </div>
  )
}
