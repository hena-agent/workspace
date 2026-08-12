import { Button } from "@/components/ui/button"
import { ConnectionStatusDot } from "@/shell/connection-status-dot"
import type { Connection } from "@/lib/types"
import { SettingsRow } from "./settings-row"

export function ServersSection({
  connections,
  onRemove,
}: {
  connections: Connection[]
  onRemove: (connectionId: string) => void
}) {
  return (
    <div className="divide-y">
      {connections.map((connection) => (
        <SettingsRow key={connection.id} label={connection.name} description={connection.url}>
          <div className="flex items-center gap-3">
            <ConnectionStatusDot status={connection.status} />
            <Button variant="ghost" size="sm" onClick={() => onRemove(connection.id)} className="hit-area">
              Remove
            </Button>
          </div>
        </SettingsRow>
      ))}
    </div>
  )
}
