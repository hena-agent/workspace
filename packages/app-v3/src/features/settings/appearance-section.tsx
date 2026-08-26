import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { isOneOf } from "@/lib/utils"
import { SettingsRow } from "./settings-row"

export type FontSizePreference = "small" | "medium" | "large"

const FONT_SIZE_VALUES: FontSizePreference[] = ["small", "medium", "large"]

export function AppearanceSection({
  fontSize,
  onChangeFontSize,
  reducedMotion,
  onChangeReducedMotion,
}: {
  fontSize: FontSizePreference
  onChangeFontSize: (size: FontSizePreference) => void
  reducedMotion: boolean
  onChangeReducedMotion: (value: boolean) => void
}) {
  return (
    <div className="divide-y">
      <SettingsRow label="Font size">
        <Select
          value={fontSize}
          onValueChange={(value) => {
            if (isOneOf(FONT_SIZE_VALUES, value)) onChangeFontSize(value)
          }}
        >
          <SelectTrigger size="sm" aria-label="Font size" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="small">Small</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="large">Large</SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow label="Reduce motion" description="Limits transitions to opacity changes.">
        <Switch checked={reducedMotion} onCheckedChange={onChangeReducedMotion} aria-label="Reduce motion" />
      </SettingsRow>
    </div>
  )
}
