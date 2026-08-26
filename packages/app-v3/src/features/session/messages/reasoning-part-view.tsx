import { useState, useSyncExternalStore } from "react"
import { Brain, ChevronDown, ChevronUp } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { ReasoningPart } from "@/lib/types"

export function ReasoningPartView({ part }: { part: ReasoningPart }) {
  const [open, setOpen] = useState(false)
  const live = useSyncExternalStore(part.live?.subscribe ?? emptySubscribe, part.live?.snapshot ?? emptySnapshot, emptySnapshot)

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border border-dashed px-2 py-1.5">
      <CollapsibleTrigger className="flex hit-area items-center gap-1.5 text-xs text-muted-foreground">
        <Brain aria-hidden className="size-3.5" />
        Thinking
        {open ? <ChevronUp aria-hidden className="size-3" /> : <ChevronDown aria-hidden className="size-3" />}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5 text-xs whitespace-pre-wrap text-muted-foreground italic">
         {part.text || live}
         {part.live?.incomplete() ? " (stream incomplete)" : ""}
      </CollapsibleContent>
    </Collapsible>
  )
}

function emptySubscribe() { return () => {} }
function emptySnapshot() { return "" }
