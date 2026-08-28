import { useSyncExternalStore } from "react"
import { Schema } from "effect"
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool"
import type { ToolPart } from "@/lib/types"
import { FullContent } from "./full-content"

const TOOL_STATE = {
  pending: "input-streaming",
  running: "input-available",
  completed: "output-available",
  error: "output-error",
} as const

export function ToolPartView({ part }: { part: ToolPart }) {
  const liveInput = useSyncExternalStore(part.liveInput?.subscribe ?? emptySubscribe, part.liveInput?.snapshot ?? emptySnapshot, emptySnapshot)
  const input = part.input || liveInput
  const parsedInput = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)(input)
  const summary = input.length > 120 ? `${input.slice(0, 117)}...` : input
  const duration = part.durationMs === undefined ? "" : ` · ${part.durationMs}ms`

  return (
    <Tool className="mb-0" data-tool-state={TOOL_STATE[part.status]}>
      <ToolHeader className="[&>div]:min-w-0 [&>div>span]:truncate" type="dynamic-tool" toolName={part.tool} state={TOOL_STATE[part.status]} title={`${part.tool} ${summary}${duration}`} />
      <ToolContent>
        {parsedInput._tag === "Some" ? <ToolInput input={parsedInput.value} /> : (
          <div className="space-y-2 overflow-hidden">
            <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">Parameters</h4>
            <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 text-xs whitespace-pre-wrap">{input}</pre>
          </div>
        )}
        {part.outputContent ? (
          <ToolOutput output={<FullContent content={part.outputContent} preview={part.output ?? ""} />} errorText={part.status === "error" ? "Tool failed" : undefined} />
        ) : (
          <ToolOutput output={part.status === "error" ? undefined : part.output} errorText={part.status === "error" ? part.output : undefined} />
        )}
        {part.liveInput?.incomplete() ? <span className="text-amber-600">Tool input stream incomplete</span> : null}
      </ToolContent>
    </Tool>
  )
}

function emptySubscribe() { return () => {} }
function emptySnapshot() { return "" }
