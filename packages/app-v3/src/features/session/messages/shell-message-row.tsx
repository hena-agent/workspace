import { TerminalSquare } from "lucide-react"
import type { ShellMessage } from "@/lib/types"

export function ShellMessageRow({ message }: { message: ShellMessage }) {
  return (
    <div
      data-role="shell"
      className="mx-4 my-1 flex flex-col gap-1 rounded-md bg-muted px-3 py-2 font-mono text-xs md:mx-5"
    >
      <div className="flex items-center gap-1.5">
        <TerminalSquare aria-hidden className="size-3.5 shrink-0" />
        <span>{message.command}</span>
      </div>
      {message.output ? (
        <pre className="overflow-x-auto whitespace-pre-wrap text-muted-foreground">{message.output}</pre>
      ) : null}
    </div>
  )
}
