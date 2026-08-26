import { AppearanceSection, type FontSizePreference } from "./appearance-section"
import { GeneralSection, type DensityPreference } from "./general-section"
import type { Theme } from "@/lib/theme"
import { KeybindingsSection } from "./keybindings-section"
import { NotificationsSection, type NotificationPreferences } from "./notifications-section"
import type { ProfileSettingsSection } from "./profile-settings-sections"

export type { ProfileSettingsSection } from "./profile-settings-sections"

export function ProfileSettingsView({
  section,
  theme,
  onChangeTheme,
  density,
  onChangeDensity,
  fontSize,
  onChangeFontSize,
  reducedMotion,
  onChangeReducedMotion,
  notifications,
  onChangeNotifications,
}: {
  section: ProfileSettingsSection
  theme: Theme
  onChangeTheme: (theme: Theme) => void
  density: DensityPreference
  onChangeDensity: (density: DensityPreference) => void
  fontSize: FontSizePreference
  onChangeFontSize: (size: FontSizePreference) => void
  reducedMotion: boolean
  onChangeReducedMotion: (value: boolean) => void
  notifications: NotificationPreferences
  onChangeNotifications: (next: NotificationPreferences) => void
}) {
  const content = (() => {
    switch (section) {
      case "general":
        return (
          <GeneralSection
            theme={theme}
            onChangeTheme={onChangeTheme}
            density={density}
            onChangeDensity={onChangeDensity}
          />
        )
      case "appearance":
        return (
          <AppearanceSection
            fontSize={fontSize}
            onChangeFontSize={onChangeFontSize}
            reducedMotion={reducedMotion}
            onChangeReducedMotion={onChangeReducedMotion}
          />
        )
      case "notifications":
        return <NotificationsSection preferences={notifications} onChange={onChangeNotifications} />
      case "keybindings":
        return <KeybindingsSection />
      default:
        section satisfies never
        return null
    }
  })()

  return content
}
