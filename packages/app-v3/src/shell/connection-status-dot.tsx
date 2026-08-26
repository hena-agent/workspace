import { cn } from "@/lib/utils"
import type { ConnectionStatus } from "@/lib/types"

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  online: "Online",
  connecting: "Connecting",
  offline: "Offline",
}

const STATUS_CLASS: Record<ConnectionStatus, string> = {
  online: "bg-emerald-500",
  connecting: "bg-amber-500 animate-pulse",
  offline: "bg-muted-foreground/40",
}

export function ConnectionStatusDot({ status, className }: { status: ConnectionStatus; className?: string }) {
  return (
    <span
      role="status"
      aria-label={STATUS_LABEL[status]}
      title={STATUS_LABEL[status]}
      className={cn("inline-block size-2 shrink-0 rounded-full", STATUS_CLASS[status], className)}
    />
  )
}
