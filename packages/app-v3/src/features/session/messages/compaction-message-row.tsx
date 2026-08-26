import type { CompactionMessage } from "@/lib/types"

export function CompactionMessageRow({ message }: { message: CompactionMessage }) {
  return (
    <div
      data-role="compaction"
      className="mx-4 my-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground md:mx-5"
    >
      <span className="font-medium text-foreground">Compacted history · </span>
      {message.summary}
      {!message.final ? <span className="ml-1 italic">summarizing…</span> : null}
    </div>
  )
}
