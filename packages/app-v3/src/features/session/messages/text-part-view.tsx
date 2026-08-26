import { useSyncExternalStore } from "react"
import type { TextPart } from "@/lib/types"
import { FullContent } from "./full-content"

// A single-purpose seam: dummy data renders as plain text today, but every
// caller goes through this component so swapping in Streamdown later (per
// the web-ui spec) touches one file, not every message row.
export function TextPartView({ part }: { part: TextPart }) {
  const live = useSyncExternalStore(part.live?.subscribe ?? emptySubscribe, part.live?.snapshot ?? emptySnapshot, emptySnapshot)
  const incomplete = part.live?.incomplete() ?? false
  const text = part.text || live
  if (part.content) return <div className="text-sm"><FullContent content={part.content} preview={text} /></div>
  return <p className="text-sm whitespace-pre-wrap">{text}{incomplete ? <span className="ml-2 text-xs text-amber-600">Stream incomplete</span> : null}</p>
}

function emptySubscribe() { return () => {} }
function emptySnapshot() { return "" }
