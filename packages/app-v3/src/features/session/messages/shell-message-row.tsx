import { lazy, Suspense } from "react"
import { TerminalSquare } from "lucide-react"
import { Message, MessageContent } from "@/components/ai-elements/message"
import type { ShellMessage } from "@/lib/types"

const Terminal = lazy(async () => {
  const { Terminal } = await import("@/components/ai-elements/terminal")
  return { default: Terminal }
})

export function ShellMessageRow({ message }: { message: ShellMessage }) {
  return (
    <Message from="assistant" data-role="shell" className="max-w-none px-4 py-1 md:px-5">
      <MessageContent className="w-full gap-1 font-mono text-xs">
        <div className="flex items-center gap-1.5">
          <TerminalSquare aria-hidden className="size-3.5 shrink-0" />
          <span>{message.command}</span>
        </div>
        {message.output ? (
          <Suspense fallback={<pre className="overflow-x-auto whitespace-pre-wrap text-muted-foreground">{message.output}</pre>}>
            <Terminal aria-label="Shell output" output={message.output} className="text-xs" />
          </Suspense>
        ) : null}
      </MessageContent>
    </Message>
  )
}
