import { Button } from "@/components/ui/button"
import { SettingsRow } from "./settings-row"

export function StorageSection({
  usedMib,
  budgetMib,
  onClearCache,
  onRemoveAllData,
}: {
  usedMib: number
  budgetMib: number
  onClearCache: () => void
  onRemoveAllData: () => void
}) {
  const percent = Math.min(100, Math.round((usedMib / budgetMib) * 100))

  return (
    <div className="flex flex-col gap-4 py-3">
      <div>
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Local storage</span>
          <span className="text-muted-foreground">
            {usedMib} MiB of {budgetMib} MiB
          </span>
        </div>
        <div
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={percent}
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <SettingsRow label="Clear cached transcripts" description="Frees space; sessions re-sync from the server.">
        <Button variant="outline" size="sm" onClick={onClearCache} className="hit-area">
          Clear
        </Button>
      </SettingsRow>
      <SettingsRow label="Remove all local data" description="Signs out this server and removes its local data.">
        <Button variant="destructive" size="sm" onClick={onRemoveAllData} className="hit-area">
          Remove
        </Button>
      </SettingsRow>
    </div>
  )
}
