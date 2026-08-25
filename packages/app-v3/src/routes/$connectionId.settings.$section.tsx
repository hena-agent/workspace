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
import { useConnectionAgent, useServers } from "@/connection/provider"
import { useCatalog, useProjects, useSettings } from "@/data/queries"
import { replaceSettingOptimistically } from "@/mutations/settings"
import { isOneOf } from "@/lib/utils"

export const Route = createFileRoute("/$connectionId/settings/$section")({
  component: SettingsRoute,
  remountDeps: ({ params }) => params.connectionId,
})

function SettingsRoute() {
  const { connectionId, section } = Route.useParams()
  const navigate = useNavigate()
  const servers = useServers()
  const server = servers.getServerBySlug(connectionId)
  const agent = useConnectionAgent(connectionId)
  const projects = useProjects(agent)
  const location = projects[0] ? { directory: projects[0].path } : undefined
  const scope = location ? JSON.stringify(location) : "missing"
  const catalog = useCatalog(agent, location)
  const syncedSettings = useSettings(agent, scope)
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
      providers={catalog.providers}
      agents={catalog.agents}
      models={catalog.models}
      mcpServers={[]}
      connections={servers.connections}
      onRemoveConnection={(id) => servers.removeServer(id)}
      storage={{
        usedMib: 0,
        budgetMib: 50,
      }}
      defaults={{
        agent: typeof syncedSettings.defaultAgent === "string" ? syncedSettings.defaultAgent : undefined,
        model: modelSetting(syncedSettings.defaultModel),
        queueDelivery: syncedSettings.queueDelivery === "queue" ? "queue" : "steer",
      }}
      onChangeDefault={agent && location ? async (key, value) => {
        const settingValue = key === "defaultModel"
          ? { providerID: value.slice(0, value.indexOf(":")), id: value.slice(value.indexOf(":") + 1) }
          : value
        await replaceSettingOptimistically(agent, { scope, key, value: settingValue })
      } : undefined}
    />
  )

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-4 md:flex-row md:p-6">
      <SettingsNav sections={SETTINGS_SECTIONS} active={profileSection ?? serverSection} onSelect={selectSection} />
      <div className="min-w-0 flex-1">{content}</div>
    </div>
  )
}

function modelSetting(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return
  const model = value as Record<string, unknown>
  return typeof model.providerID === "string" && typeof model.id === "string" ? `${model.providerID}:${model.id}` : undefined
}
