import { Info } from "lucide-react"
import type { SyntheticMessage, SystemMessage } from "@/lib/types"

export function SystemMessageRow({ message }: { message: SystemMessage | SyntheticMessage }) {
  return (
    <div
      data-role={message.role}
      className="mx-4 my-1 flex items-center gap-1.5 px-2 text-xs text-muted-foreground italic md:mx-5"
    >
      <Info aria-hidden className="size-3.5 shrink-0" />
      {message.text}
    </div>
  )
}
