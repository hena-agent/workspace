import { ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { PermissionRequest } from "@/lib/types"

export function PermissionDock({
  request,
  onDeny,
  onAllowOnce,
  onAllowAlways,
}: {
  request: PermissionRequest
  onDeny: () => void
  onAllowOnce: () => void
  onAllowAlways: () => void
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{request.title}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">{request.description}</p>
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDeny} className="hit-area">
          Deny
        </Button>
        <Button variant="outline" size="sm" onClick={onAllowOnce} className="hit-area">
          Allow once
        </Button>
        <Button size="sm" onClick={onAllowAlways} className="hit-area">
          Always allow
        </Button>
      </div>
    </div>
  )
}
