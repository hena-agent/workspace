import { Bot } from "lucide-react"
import type { AssistantMessage } from "@/lib/types"
import { Message, MessageContent } from "@/components/ai-elements/message"
import { ReasoningPartView } from "./reasoning-part-view"
import { TextPartView } from "./text-part-view"
import { ToolPartView } from "./tool-part-view"

export function AssistantMessageRow({ message, working }: { message: AssistantMessage; working?: boolean }) {
  return (
    <Message from="assistant" data-role="assistant" className="max-w-none px-4 py-3 md:px-5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Bot aria-hidden className="size-3.5" />
        {message.agent ?? "assistant"}
        {message.model ? <span className="font-normal text-muted-foreground/70">· {message.model}</span> : null}
      </div>
      <MessageContent className="w-full gap-2">
        {message.parts.map((part, index) => (
          <div key={part.id}>
            {part.kind === "text" ? <TextPartView part={part} isStreaming={working && index === message.parts.length - 1} /> : null}
            {part.kind === "reasoning" ? <ReasoningPartView part={part} isStreaming={working && index === message.parts.length - 1} /> : null}
            {part.kind === "tool" ? <ToolPartView part={part} /> : null}
            {part.kind === "unknown" ? (
              <div className="max-h-32 overflow-auto rounded-md border border-dashed p-2 text-xs break-words whitespace-pre-wrap text-muted-foreground">
                <span className="font-medium text-foreground">Unsupported part: {part.type.slice(0, 80)}</span>
                {"\n"}{part.summary.slice(0, 500)}{part.summary.length > 500 ? "..." : ""}
              </div>
            ) : null}
          </div>
        ))}
      </MessageContent>
    </Message>
  )
}
