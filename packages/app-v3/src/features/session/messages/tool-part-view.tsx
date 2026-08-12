import { useState } from "react"
import { Check, Circle, Loader2, X } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import type { ToolPart } from "@/lib/types"

const STATUS_ICON = { pending: Circle, running: Loader2, completed: Check, error: X } as const
const STATUS_CLASS = {
  pending: "text-muted-foreground",
  running: "text-muted-foreground animate-spin",
  completed: "text-emerald-500",
  error: "text-destructive",
} as const
const STATUS_LABEL = { pending: "Pending", running: "Running", completed: "Completed", error: "Error" } as const

export function ToolPartView({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false)
  const StatusIcon = STATUS_ICON[part.status]

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border px-2 py-1.5">
      <CollapsibleTrigger className="flex hit-area w-full items-center gap-1.5 text-left text-xs">
        <StatusIcon
          aria-label={STATUS_LABEL[part.status]}
          className={cn("size-3.5 shrink-0", STATUS_CLASS[part.status])}
        />
        <span className="font-mono font-medium">{part.tool}</span>
        <span className="truncate text-muted-foreground">{part.input}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5 flex flex-col gap-1 text-xs">
        <pre className="overflow-x-auto rounded-sm bg-muted p-2 font-mono">{part.input}</pre>
        {part.output ? <pre className="overflow-x-auto rounded-sm bg-muted p-2 font-mono">{part.output}</pre> : null}
      </CollapsibleContent>
    </Collapsible>
  )
}
