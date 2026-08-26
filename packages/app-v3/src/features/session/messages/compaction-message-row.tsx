import type { CompactionMessage } from "@/lib/types"
import { Marker, MarkerContent } from "@/components/ui/marker"

export function CompactionMessageRow({ message }: { message: CompactionMessage }) {
  return (
    <Marker
      variant="border"
      data-role="compaction"
      className="my-2 px-6 pb-2 text-xs md:px-7"
    >
      <MarkerContent>
        <span className="font-medium text-foreground">Compacted history · </span>
        {message.summary}
        {!message.final ? <span className="ml-1 italic">summarizing…</span> : null}
      </MarkerContent>
    </Marker>
  )
}
