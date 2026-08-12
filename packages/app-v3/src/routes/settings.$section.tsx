import { useState } from "react"
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
  const [density, setDensity] = useState<DensityPreference>("comfortable")
  const [fontSize, setFontSize] = useState<FontSizePreference>("medium")
  const [reducedMotion, setReducedMotion] = useState(false)
  const [notifications, setNotifications] = useState<NotificationPreferences>({ sound: true, desktop: false })

  return (
    <ProfileSettingsView
      section={section}
      onSelectSection={(next) => void navigate({ to: "/settings/$section", params: { section: next } })}
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
