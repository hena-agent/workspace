import { useSyncExternalStore } from "react"
import { MessageResponse } from "@/components/ai-elements/message"
import type { TextPart } from "@/lib/types"
import { FullContent } from "./full-content"
import { markdownComponents } from "./markdown"

export function TextPartView({ part, isStreaming }: { part: TextPart; isStreaming?: boolean }) {
  const live = useSyncExternalStore(part.live?.subscribe ?? emptySubscribe, part.live?.snapshot ?? emptySnapshot, emptySnapshot)
  const incomplete = part.live?.incomplete() ?? false
  const text = live || part.text
  if (part.content) return <div className="text-sm"><FullContent content={part.content} preview={text} render={(content) => <MessageResponse components={markdownComponents} mode="static">{content}</MessageResponse>} /></div>
  return <div className="text-sm"><MessageResponse animated={isStreaming} components={markdownComponents} isAnimating={isStreaming} mode={isStreaming ? "streaming" : "static"}>{text}</MessageResponse>{incomplete ? <span className="text-xs text-amber-600">Stream incomplete</span> : null}</div>
}

function emptySubscribe() { return () => {} }
function emptySnapshot() { return "" }
