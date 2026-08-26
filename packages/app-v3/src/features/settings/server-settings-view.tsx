import type { Connection, McpServer, Model, Provider } from "@/lib/types"
import { McpSection } from "./mcp-section"
import { ModelsSection } from "./models-section"
import { ProvidersSection } from "./providers-section"
import type { ServerSettingsSection } from "./server-settings-sections"
import { ServersSection } from "./servers-section"
import { StorageSection } from "./storage-section"

export type { ServerSettingsSection } from "./server-settings-sections"

export function ServerSettingsView({
  section,
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
      case "server-connections":
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

  return content
}
