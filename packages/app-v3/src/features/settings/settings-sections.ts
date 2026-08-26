import { PROFILE_SETTINGS_SECTIONS } from "./profile-settings-sections"
import { SERVER_SETTINGS_SECTIONS } from "./server-settings-sections"

export const SETTINGS_SECTIONS = [...PROFILE_SETTINGS_SECTIONS, ...SERVER_SETTINGS_SECTIONS] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"]
