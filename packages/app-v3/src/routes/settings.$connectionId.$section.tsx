import { useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { isOneOf } from "@/lib/utils"
import { getConnection, listConnections, listMcpServers, listModels, listProviders } from "@/mock/queries"
import { ServerSettingsView } from "@/features/settings/server-settings-view"
import { SERVER_SETTINGS_SECTION_VALUES } from "@/features/settings/server-settings-sections"

export const Route = createFileRoute("/settings/$connectionId/$section")({
  component: ServerSettingsRoute,
  remountDeps: ({ params }) => ({ connectionId: params.connectionId }),
})

function ServerSettingsRoute() {
  const { connectionId, section: rawSection } = Route.useParams()
  const section = isOneOf(SERVER_SETTINGS_SECTION_VALUES, rawSection) ? rawSection : "providers"
  const navigate = useNavigate()
  const [providers, setProviders] = useState(() => listProviders())

  if (!getConnection(connectionId)) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Connection not found.</div>
    )
  }

  return (
    <ServerSettingsView
      section={section}
      onSelectSection={(next) =>
        void navigate({
          to: "/settings/$connectionId/$section",
          params: { connectionId, section: next },
          replace: true,
        })
      }
      providers={providers}
      onToggleProviderConnection={(id) =>
        setProviders((current) =>
          current.map((provider) => (provider.id === id ? { ...provider, connected: !provider.connected } : provider)),
        )
      }
      models={listModels()}
      mcpServers={listMcpServers()}
      connections={listConnections()}
      onRemoveConnection={() => {}}
    />
  )
}
