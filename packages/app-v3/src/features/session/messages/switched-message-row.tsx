import { ArrowLeftRight } from "lucide-react"
import type { AgentSwitchedMessage, ModelSwitchedMessage } from "@/lib/types"

export function SwitchedMessageRow({ message }: { message: AgentSwitchedMessage | ModelSwitchedMessage }) {
  const label = message.role === "agent-switched" ? "Agent" : "Model"

  return (
    <div
      data-role={message.role}
      className="mx-4 my-1 flex items-center gap-1.5 px-2 text-xs text-muted-foreground md:mx-5"
    >
      <ArrowLeftRight aria-hidden className="size-3 shrink-0" />
      {label} changed: {message.from} → {message.to}
    </div>
  )
}
