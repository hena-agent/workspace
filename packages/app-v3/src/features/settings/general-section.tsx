import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { isOneOf } from "@/lib/utils"
import { SettingsRow } from "./settings-row"

export type ThemePreference = "system" | "light" | "dark"
export type DensityPreference = "comfortable" | "compact"

const THEME_VALUES: ThemePreference[] = ["system", "light", "dark"]
const DENSITY_VALUES: DensityPreference[] = ["comfortable", "compact"]

export function GeneralSection({
  theme,
  onChangeTheme,
  density,
  onChangeDensity,
}: {
  theme: ThemePreference
  onChangeTheme: (theme: ThemePreference) => void
  density: DensityPreference
  onChangeDensity: (density: DensityPreference) => void
}) {
  return (
    <div className="divide-y">
      <SettingsRow label="Theme" description="Applies immediately across the app.">
        <Select
          value={theme}
          onValueChange={(value) => {
            if (isOneOf(THEME_VALUES, value)) onChangeTheme(value)
          }}
        >
          <SelectTrigger size="sm" aria-label="Theme" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">System</SelectItem>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow
        label="Density"
        description="Compact reduces row height on pointer devices; touch targets stay full size."
      >
        <Select
          value={density}
          onValueChange={(value) => {
            if (isOneOf(DENSITY_VALUES, value)) onChangeDensity(value)
          }}
        >
          <SelectTrigger size="sm" aria-label="Density" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="comfortable">Comfortable</SelectItem>
            <SelectItem value="compact">Compact</SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>
    </div>
  )
}
