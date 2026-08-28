import { useSyncExternalStore } from "react"
import { Schema } from "effect"
import { CodeBlock } from "@/components/ai-elements/code-block"
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
  const summary = input.length > 120 ? `${input.slice(0, 117)}...` : input
  const duration = part.durationMs === undefined ? "" : ` · ${part.durationMs}ms`

  return (
    <Tool className="mb-0" data-tool-state={TOOL_STATE[part.status]}>
      <ToolHeader type="dynamic-tool" toolName={part.tool} state={TOOL_STATE[part.status]} title={`${part.tool} ${summary}${duration}`} />
      <ToolContent>
        <ToolInput input={toolInput(input)} />
        {part.outputContent ? (
          <ToolOutput output={<FullContent content={part.outputContent} preview={part.output ?? ""} render={(output) => <CodeBlock code={output} language="json" />} />} errorText={undefined} />
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

function toolInput(input: string) {
  const decoded = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)(input)
  return decoded._tag === "Some" ? decoded.value : input
}
