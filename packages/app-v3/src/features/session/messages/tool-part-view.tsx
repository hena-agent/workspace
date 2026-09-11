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
  const liveInput = useSyncExternalStore(
    part.liveInput?.subscribe ?? emptySubscribe,
    part.liveInput?.snapshot ?? emptySnapshot,
    emptySnapshot,
  )
  const input = part.input || liveInput
  const summary = input.length > 120 ? `${input.slice(0, 117)}...` : input
  const duration = part.durationMs === undefined ? "" : ` · ${part.durationMs}ms`

  return (
    <Tool className="mb-0" data-tool-state={TOOL_STATE[part.status]}>
      <ToolHeader
        className="[&>div]:min-w-0 [&>div>span]:truncate"
        type="dynamic-tool"
        toolName={part.tool}
        state={TOOL_STATE[part.status]}
        title={`${part.tool} ${summary}${duration}`}
      />
      <ToolContent>
        <ToolInputView input={input} />
        <ToolOutputView part={part} />
        {part.liveInput?.incomplete() ? <span className="text-amber-600">Tool input stream incomplete</span> : null}
      </ToolContent>
    </Tool>
  )
}

function ToolInputView({ input }: { input: string }) {
  const parsed = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(input)
  if (parsed._tag === "Some") return <ToolInput input={parsed.value} />
  return (
    <div className="flex flex-col gap-2 overflow-hidden">
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Parameters</h4>
      <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 text-xs whitespace-pre-wrap">{input}</pre>
    </div>
  )
}

function ToolOutputView({ part }: { part: ToolPart }) {
  const paged =
    part.outputParts ??
    (part.outputContent
      ? [{ id: part.outputContent.id, text: part.output ?? "", content: part.outputContent }]
      : undefined)
  const error = part.status === "error" ? (part.error ?? (paged ? "Tool failed" : part.output)) : undefined
  if (!paged)
    return <ToolOutput output={part.status === "error" && !part.error ? undefined : part.output} errorText={error} />
  return (
    <ToolOutput
      output={
        <>
          {paged.map((item) =>
            item.content ? (
              <FullContent key={item.id} content={item.content} preview={item.text} />
            ) : (
              <pre key={item.id} className="overflow-x-auto whitespace-pre-wrap">
                {item.text}
              </pre>
            ),
          )}
        </>
      }
      errorText={error}
    />
  )
}

function emptySubscribe() {
  return () => {}
}
function emptySnapshot() {
  return ""
}
