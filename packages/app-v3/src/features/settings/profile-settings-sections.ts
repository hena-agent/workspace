export const PROFILE_SETTINGS_SECTIONS = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "notifications", label: "Notifications" },
  { id: "keybindings", label: "Keybindings" },
  { id: "storage", label: "Storage" },
] as const

export type ProfileSettingsSection = (typeof PROFILE_SETTINGS_SECTIONS)[number]["id"]
export const PROFILE_SETTINGS_SECTION_VALUES: ProfileSettingsSection[] = PROFILE_SETTINGS_SECTIONS.map(
  (section) => section.id,
)
