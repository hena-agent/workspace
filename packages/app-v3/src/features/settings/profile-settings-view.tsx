import { AppearanceSection, type FontSizePreference } from "./appearance-section"
import { GeneralSection, type DensityPreference, type ThemePreference } from "./general-section"
import { KeybindingsSection } from "./keybindings-section"
import { NotificationsSection, type NotificationPreferences } from "./notifications-section"
import { PROFILE_SETTINGS_SECTIONS, type ProfileSettingsSection } from "./profile-settings-sections"
import { SettingsNav } from "./settings-nav"
import { StorageSection } from "./storage-section"

export type { ProfileSettingsSection } from "./profile-settings-sections"

export function ProfileSettingsView({
  section,
  onSelectSection,
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
  storage,
  onClearCache,
  onRemoveAllData,
}: {
  section: ProfileSettingsSection
  onSelectSection: (section: ProfileSettingsSection) => void
  theme: ThemePreference
  onChangeTheme: (theme: ThemePreference) => void
  density: DensityPreference
  onChangeDensity: (density: DensityPreference) => void
  fontSize: FontSizePreference
  onChangeFontSize: (size: FontSizePreference) => void
  reducedMotion: boolean
  onChangeReducedMotion: (value: boolean) => void
  notifications: NotificationPreferences
  onChangeNotifications: (next: NotificationPreferences) => void
  storage: { usedMib: number; budgetMib: number }
  onClearCache: () => void
  onRemoveAllData: () => void
}) {
  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-4 md:flex-row md:p-6">
      <SettingsNav sections={PROFILE_SETTINGS_SECTIONS} active={section} onSelect={onSelectSection} />
      <div className="min-w-0 flex-1">
        {section === "general" ? (
          <GeneralSection
            theme={theme}
            onChangeTheme={onChangeTheme}
            density={density}
            onChangeDensity={onChangeDensity}
          />
        ) : null}
        {section === "appearance" ? (
          <AppearanceSection
            fontSize={fontSize}
            onChangeFontSize={onChangeFontSize}
            reducedMotion={reducedMotion}
            onChangeReducedMotion={onChangeReducedMotion}
          />
        ) : null}
        {section === "notifications" ? (
          <NotificationsSection preferences={notifications} onChange={onChangeNotifications} />
        ) : null}
        {section === "keybindings" ? <KeybindingsSection /> : null}
        {section === "storage" ? (
          <StorageSection
            usedMib={storage.usedMib}
            budgetMib={storage.budgetMib}
            onClearCache={onClearCache}
            onRemoveAllData={onRemoveAllData}
          />
        ) : null}
      </div>
    </div>
  )
}
