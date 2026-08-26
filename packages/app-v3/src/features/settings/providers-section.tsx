import { Button } from "@/components/ui/button"
import type { Provider } from "@/lib/types"
import { SettingsRow } from "./settings-row"

export function ProvidersSection({
  providers,
  onToggleConnection,
}: {
  providers: Provider[]
  onToggleConnection?: (providerId: string) => void
}) {
  return (
    <div className="divide-y">
      {providers.map((provider) => (
        <SettingsRow
          key={provider.id}
          label={provider.name}
          description={provider.connected ? "Connected" : "Not connected"}
        >
          {onToggleConnection ? (
            <Button
              variant={provider.connected ? "outline" : "default"}
              size="sm"
              onClick={() => onToggleConnection(provider.id)}
              aria-label={`${provider.connected ? "Disconnect" : "Connect"} ${provider.name}`}
              className="hit-area"
            >
              {provider.connected ? "Disconnect" : "Connect"}
            </Button>
          ) : <span className="text-xs text-muted-foreground">Read only</span>}
        </SettingsRow>
      ))}
    </div>
  )
}
