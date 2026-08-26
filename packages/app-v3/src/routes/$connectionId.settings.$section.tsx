import { useEffect, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useTheme } from "@/components/theme-provider"
import type { FontSizePreference } from "@/features/settings/appearance-section"
import type { DensityPreference } from "@/features/settings/general-section"
import type { NotificationPreferences } from "@/features/settings/notifications-section"
import { ProfileSettingsView } from "@/features/settings/profile-settings-view"
import { PROFILE_SETTINGS_SECTION_VALUES } from "@/features/settings/profile-settings-sections"
import { ServerSettingsView } from "@/features/settings/server-settings-view"
import { SERVER_SETTINGS_SECTION_VALUES } from "@/features/settings/server-settings-sections"
import { SettingsNav } from "@/features/settings/settings-nav"
import { SETTINGS_SECTIONS, type SettingsSection } from "@/features/settings/settings-sections"
import { useMockServers } from "@/features/server/mock-server-provider"
import { isOneOf } from "@/lib/utils"
import { listMcpServers, listModels, listProviders } from "@/mock/queries"

export const Route = createFileRoute("/$connectionId/settings/$section")({
  component: SettingsRoute,
  remountDeps: ({ params }) => params.connectionId,
})

function SettingsRoute() {
  const { connectionId, section } = Route.useParams()
  const navigate = useNavigate()
  const servers = useMockServers()
  const server = servers.getServerBySlug(connectionId)
  const { theme, setTheme } = useTheme()
  const [density, setDensity] = useState<DensityPreference>(() => {
    const stored = localStorage.getItem("density")
    if (stored === "comfortable" || stored === "compact") return stored
    return window.matchMedia("(any-pointer: fine)").matches ? "compact" : "comfortable"
  })
  const [fontSize, setFontSize] = useState<FontSizePreference>(() => {
    const stored = localStorage.getItem("font-size")
    return stored === "small" || stored === "large" ? stored : "medium"
  })
  const [reducedMotion, setReducedMotion] = useState(() => localStorage.getItem("reduced-motion") === "true")
  const [notifications, setNotifications] = useState<NotificationPreferences>({ sound: true, desktop: false })
  const [providers, setProviders] = useState(() => listProviders())

  useEffect(() => {
    document.documentElement.dataset.density = density
    document.documentElement.dataset.fontSize = fontSize
    document.documentElement.dataset.reducedMotion = String(reducedMotion)
    localStorage.setItem("density", density)
    localStorage.setItem("font-size", fontSize)
    localStorage.setItem("reduced-motion", String(reducedMotion))
  }, [density, fontSize, reducedMotion])

  if (!server) {
    return <div className="flex size-full items-center justify-center text-sm text-muted-foreground">Connection not found.</div>
  }

  function selectSection(next: SettingsSection) {
    void navigate({
      to: "/$connectionId/settings/$section",
      params: { connectionId, section: next },
      replace: true,
    })
  }

  const profileSection = isOneOf(PROFILE_SETTINGS_SECTION_VALUES, section) ? section : undefined
  const serverSection = isOneOf(SERVER_SETTINGS_SECTION_VALUES, section) ? section : "providers"
  const content = profileSection ? (
    <ProfileSettingsView
      section={profileSection}
      theme={theme}
      onChangeTheme={setTheme}
      density={density}
      onChangeDensity={setDensity}
      fontSize={fontSize}
      onChangeFontSize={setFontSize}
      reducedMotion={reducedMotion}
      onChangeReducedMotion={setReducedMotion}
      notifications={notifications}
      onChangeNotifications={setNotifications}
    />
  ) : (
    <ServerSettingsView
      section={serverSection}
      providers={providers}
      onToggleProviderConnection={(id) =>
        setProviders((current) =>
          current.map((provider) => (provider.id === id ? { ...provider, connected: !provider.connected } : provider)),
        )
      }
      models={listModels()}
      mcpServers={listMcpServers()}
      connections={servers.connections}
      onRemoveConnection={() => {}}
      storage={{
        usedMib: server.id === "conn-local" ? 18 : server.id === "conn-staging" ? 7 : 0,
        budgetMib: 50,
      }}
      onClearCache={() => {}}
      onRemoveAllData={() => {}}
    />
  )

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-4 md:flex-row md:p-6">
      <SettingsNav sections={SETTINGS_SECTIONS} active={profileSection ?? serverSection} onSelect={selectSection} />
      <div className="min-w-0 flex-1">{content}</div>
    </div>
  )
}
