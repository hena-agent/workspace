import type { Connection, McpServer, Model, Provider } from "@/lib/types"
import { McpSection } from "./mcp-section"
import { ModelsSection } from "./models-section"
import { ProvidersSection } from "./providers-section"
import type { ServerSettingsSection } from "./server-settings-sections"
import { ServersSection } from "./servers-section"
import { SettingsNav } from "./settings-nav"
import { SETTINGS_SECTIONS, type SettingsSection } from "./settings-sections"
import { StorageSection } from "./storage-section"

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
  storage,
  onClearCache,
  onRemoveAllData,
}: {
  section: ServerSettingsSection
  onSelectSection: (section: SettingsSection) => void
  providers: Provider[]
  onToggleProviderConnection: (providerId: string) => void
  models: Model[]
  mcpServers: McpServer[]
  connections: Connection[]
  onRemoveConnection: (connectionId: string) => void
  storage: { usedMib: number; budgetMib: number }
  onClearCache: () => void
  onRemoveAllData: () => void
}) {
  const content = (() => {
    switch (section) {
      case "providers":
        return <ProvidersSection providers={providers} onToggleConnection={onToggleProviderConnection} />
      case "models":
        return <ModelsSection models={models} providers={providers} />
      case "mcp":
        return <McpSection servers={mcpServers} />
      case "servers":
        return <ServersSection connections={connections} onRemove={onRemoveConnection} />
      case "storage":
        return (
          <StorageSection
            usedMib={storage.usedMib}
            budgetMib={storage.budgetMib}
            onClearCache={onClearCache}
            onRemoveAllData={onRemoveAllData}
          />
        )
      default:
        section satisfies never
        return null
    }
  })()

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-4 md:flex-row md:p-6">
      <SettingsNav sections={SETTINGS_SECTIONS} active={section} onSelect={onSelectSection} />
      <div className="min-w-0 flex-1">{content}</div>
    </div>
  )
}
