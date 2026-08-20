import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { isTheme, type Theme } from "@/lib/theme"
import { isOneOf } from "@/lib/utils"
import { SettingsRow } from "./settings-row"

export type DensityPreference = "comfortable" | "compact"

const DENSITY_VALUES: DensityPreference[] = ["comfortable", "compact"]

export function GeneralSection({
  theme,
  onChangeTheme,
  density,
  onChangeDensity,
}: {
  theme: Theme
  onChangeTheme: (theme: Theme) => void
  density: DensityPreference
  onChangeDensity: (density: DensityPreference) => void
}) {
  return (
    <div className="divide-y">
      <SettingsRow label="Theme" description="Applies immediately across the app.">
        <Select
          value={theme}
          onValueChange={(value) => {
            if (isTheme(value)) onChangeTheme(value)
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
