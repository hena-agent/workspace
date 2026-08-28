import { Bot } from "lucide-react"
import type { AssistantMessage } from "@/lib/types"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageContent, MessageHeader } from "@/components/ui/message"
import { ReasoningPartView } from "./reasoning-part-view"
import { TextPartView } from "./text-part-view"
import { ToolPartView } from "./tool-part-view"

export function AssistantMessageRow({ message, working }: { message: AssistantMessage; working?: boolean }) {
  return (
    <Message data-role="assistant" className="px-4 py-3 md:px-5">
      <MessageContent>
        <MessageHeader className="gap-1.5">
          <Bot aria-hidden className="size-3.5" />
          {message.agent ?? "assistant"}
          {message.model ? <span className="font-normal text-muted-foreground/70">· {message.model}</span> : null}
        </MessageHeader>
        <Bubble variant="ghost">
          <BubbleContent className="flex flex-col gap-2">
            {message.parts.map((part, index) => (
              <div key={part.id}>
                {part.kind === "text" ? <TextPartView part={part} isStreaming={working && index === message.parts.length - 1} /> : null}
                {part.kind === "reasoning" ? <ReasoningPartView part={part} isStreaming={working && index === message.parts.length - 1} /> : null}
                {part.kind === "tool" ? <ToolPartView part={part} /> : null}
              </div>
            ))}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}
