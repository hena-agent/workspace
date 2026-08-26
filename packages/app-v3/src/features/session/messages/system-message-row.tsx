import { Info } from "lucide-react"
import type { SyntheticMessage, SystemMessage } from "@/lib/types"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"

export function SystemMessageRow({ message }: { message: SystemMessage | SyntheticMessage }) {
  return (
    <Marker
      data-role={message.role}
      className="my-1 px-6 text-xs italic md:px-7"
    >
      <MarkerIcon><Info /></MarkerIcon>
      <MarkerContent>{message.text}</MarkerContent>
    </Marker>
  )
}
