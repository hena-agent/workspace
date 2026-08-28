import { useSyncExternalStore } from "react"
import { MessageResponse } from "@/components/ai-elements/message"
import { Reasoning, ReasoningTrigger } from "@/components/ai-elements/reasoning"
import { CollapsibleContent } from "@/components/ui/collapsible"
import type { ReasoningPart } from "@/lib/types"

export function ReasoningPartView({ part, isStreaming }: { part: ReasoningPart; isStreaming?: boolean }) {
  const live = useSyncExternalStore(part.live?.subscribe ?? emptySubscribe, part.live?.snapshot ?? emptySnapshot, emptySnapshot)
  const incomplete = part.live?.incomplete() ?? false

  return (
    <Reasoning isStreaming={isStreaming} className="mb-0 rounded-md border border-dashed px-2 py-1.5">
      <ReasoningTrigger className="text-xs" />
      <CollapsibleContent className="mt-1.5 text-xs italic text-muted-foreground outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:animate-in data-[state=open]:slide-in-from-top-2">
        <MessageResponse animated={isStreaming} isAnimating={isStreaming} mode={isStreaming ? "streaming" : "static"}>{`${live || part.text}${incomplete ? " (stream incomplete)" : ""}`}</MessageResponse>
      </CollapsibleContent>
    </Reasoning>
  )
}

function emptySubscribe() { return () => {} }
function emptySnapshot() { return "" }
