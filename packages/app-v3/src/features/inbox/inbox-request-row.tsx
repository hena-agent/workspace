import { CircleHelp, ShieldAlert } from "lucide-react"
import { formatRelativeTime } from "@/lib/time"
import type { InboxItem } from "@/mock/queries"

const KIND_ICON = { permission: ShieldAlert, question: CircleHelp } as const
const KIND_LABEL = { permission: "Needs permission", question: "Needs an answer" } as const
const KIND_ICON_CLASS = { permission: "text-amber-500", question: "text-blue-500" } as const

export function InboxRequestRow({ item, now, onOpen }: { item: InboxItem; now: number; onOpen: () => void }) {
  const Icon = KIND_ICON[item.kind]

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex hit-area w-full items-start gap-3 rounded-lg border px-3 py-3 text-left hover:bg-accent/60"
    >
      <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${KIND_ICON_CLASS[item.kind]}`} />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{KIND_LABEL[item.kind]}</div>
        <div className="truncate text-sm font-medium">{item.title}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {item.project.name} · {item.session.title}
        </div>
      </div>
      <div className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(item.createdAt, now)}</div>
    </button>
  )
}
