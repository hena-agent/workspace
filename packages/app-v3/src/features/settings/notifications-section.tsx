import { Switch } from "@/components/ui/switch"
import { SettingsRow } from "./settings-row"

export type NotificationPreferences = { sound: boolean; desktop: boolean }

export function NotificationsSection({
  preferences,
  onChange,
}: {
  preferences: NotificationPreferences
  onChange: (next: NotificationPreferences) => void
}) {
  return (
    <div className="divide-y">
      <SettingsRow label="Sound" description="Play a sound when a session needs you.">
        <Switch
          checked={preferences.sound}
          onCheckedChange={(checked) => onChange({ ...preferences, sound: checked })}
          aria-label="Sound"
        />
      </SettingsRow>
      <SettingsRow label="Desktop notifications" description="Requires permission, granted from this toggle.">
        <Switch
          checked={preferences.desktop}
          onCheckedChange={(checked) => onChange({ ...preferences, desktop: checked })}
          aria-label="Desktop notifications"
        />
      </SettingsRow>
    </div>
  )
}
