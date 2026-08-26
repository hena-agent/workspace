import { useEffect, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useTheme } from "@/components/theme-provider"
import type { FontSizePreference } from "@/features/settings/appearance-section"
import type { DensityPreference } from "@/features/settings/general-section"
import type { NotificationPreferences } from "@/features/settings/notifications-section"
import { ProfileSettingsView } from "@/features/settings/profile-settings-view"
import { PROFILE_SETTINGS_SECTION_VALUES } from "@/features/settings/profile-settings-sections"
import { isOneOf } from "@/lib/utils"

export const Route = createFileRoute("/settings/$section")({
  component: ProfileSettingsRoute,
})

function ProfileSettingsRoute() {
  const { section: rawSection } = Route.useParams()
  const section = isOneOf(PROFILE_SETTINGS_SECTION_VALUES, rawSection) ? rawSection : "general"
  const navigate = useNavigate()
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

  return (
    <ProfileSettingsView
      section={section}
      onSelectSection={(next) => void navigate({ to: "/settings/$section", params: { section: next }, replace: true })}
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
      storage={{ usedMib: 18, budgetMib: 50 }}
      onClearCache={() => {}}
      onRemoveAllData={() => {}}
    />
  )
}
