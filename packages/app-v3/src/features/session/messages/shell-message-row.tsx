import { TerminalSquare } from "lucide-react"
import type { ShellMessage } from "@/lib/types"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageContent } from "@/components/ui/message"

export function ShellMessageRow({ message }: { message: ShellMessage }) {
  return (
    <Message data-role="shell" className="px-4 py-1 md:px-5">
      <MessageContent>
        <Bubble variant="muted">
          <BubbleContent className="flex flex-col gap-1 font-mono text-xs">
            <div className="flex items-center gap-1.5">
              <TerminalSquare aria-hidden className="size-3.5 shrink-0" />
              <span>{message.command}</span>
            </div>
            {message.output ? (
              <pre className="overflow-x-auto whitespace-pre-wrap text-muted-foreground">{message.output}</pre>
            ) : null}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}
