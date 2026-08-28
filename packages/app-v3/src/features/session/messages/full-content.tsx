import { useState } from "react"
import type { ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import type { ContentReference } from "@/lib/types"

export function FullContent({ content, preview, render }: { content: ContentReference; preview: string; render?: (text: string) => ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  const query = useQuery({
    queryKey: content.queryKey,
    enabled: expanded,
    gcTime: 0,
    queryFn: ({ signal }) => loadAll(content, 0, "", signal),
  })
  const text = expanded && query.data !== undefined ? query.data : preview
  return (
    <div className="flex flex-col gap-2">
      {render ? render(text) : <pre className="overflow-x-auto whitespace-pre-wrap">{text}</pre>}
      <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => setExpanded((value) => !value)}>
        {expanded ? "Show preview" : `Show full output (${content.bytes} bytes)`}
      </Button>
      {query.isError ? <p className="text-xs text-destructive">Full output is unavailable.</p> : null}
    </div>
  )
}

async function loadAll(content: ContentReference, offset: number, text: string, signal: AbortSignal): Promise<string> {
  const page = await content.loadPage(offset, signal)
  const next = text + page.text
  if (page.nextOffset >= page.totalBytes) return next
  return loadAll(content, page.nextOffset, next, signal)
}
