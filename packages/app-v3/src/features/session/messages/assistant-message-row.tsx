import { Bot } from "lucide-react"
import type { AssistantMessage } from "@/lib/types"
import { ReasoningPartView } from "./reasoning-part-view"
import { TextPartView } from "./text-part-view"
import { ToolPartView } from "./tool-part-view"

export function AssistantMessageRow({ message }: { message: AssistantMessage }) {
  return (
    <div data-role="assistant" className="flex flex-col gap-2 px-4 py-3 md:px-5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Bot aria-hidden className="size-3.5" />
        {message.agent ?? "assistant"}
        {message.model ? <span className="font-normal text-muted-foreground/70">· {message.model}</span> : null}
      </div>
      <div className="flex flex-col gap-2">
        {message.parts.map((part) => (
          <div key={part.id}>
            {part.kind === "text" ? <TextPartView part={part} /> : null}
            {part.kind === "reasoning" ? <ReasoningPartView part={part} /> : null}
            {part.kind === "tool" ? <ToolPartView part={part} /> : null}
          </div>
        ))}
      </div>
    </div>
  )
}
