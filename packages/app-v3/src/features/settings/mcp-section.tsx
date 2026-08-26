import { Badge } from "@/components/ui/badge"
import type { McpServer } from "@/lib/types"

const STATUS_VARIANT = { connected: "default", disconnected: "secondary", error: "destructive" } as const
const STATUS_LABEL = { connected: "Connected", disconnected: "Disconnected", error: "Error" } as const

export function McpSection({ servers }: { servers: McpServer[] }) {
  return (
    <div className="divide-y">
      {servers.map((server) => (
        <div key={server.id} className="flex items-center justify-between py-3 text-sm">
          <span>{server.name}</span>
          <Badge variant={STATUS_VARIANT[server.status]}>{STATUS_LABEL[server.status]}</Badge>
        </div>
      ))}
    </div>
  )
}
