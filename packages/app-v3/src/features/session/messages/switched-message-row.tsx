import { ArrowLeftRight } from "lucide-react"
import type { AgentSwitchedMessage, ModelSwitchedMessage } from "@/lib/types"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"

export function SwitchedMessageRow({ message }: { message: AgentSwitchedMessage | ModelSwitchedMessage }) {
  const label = message.role === "agent-switched" ? "Agent" : "Model"

  return (
    <Marker
      data-role={message.role}
      className="my-1 px-6 text-xs md:px-7"
    >
      <MarkerIcon><ArrowLeftRight /></MarkerIcon>
      <MarkerContent>{label} changed: {message.from} → {message.to}</MarkerContent>
    </Marker>
  )
}
