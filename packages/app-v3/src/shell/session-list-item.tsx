import { Archive, CircleAlert, Loader2, Share2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Session } from "@/lib/types"

function SessionStatusIndicator({ session }: { session: Session }) {
  if (session.status === "working") {
    return <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Working" />
  }
  if (session.status === "permission" || session.status === "question") {
    return <span aria-label="Needs your input" className="size-1.5 rounded-full bg-amber-500" />
  }
  if (session.status === "error") {
    return <CircleAlert aria-label="Error" className="size-3.5 text-destructive" />
  }
  if (session.unseenCount > 0) {
    return <span aria-label="Unread" className="size-1.5 rounded-full bg-blue-500" />
  }
  return null
}

export function SessionListItem({
  session,
  active,
  onSelect,
  onArchive,
}: {
  session: Session
  active: boolean
  onSelect: () => void
  onArchive: () => void
}) {
  return (
    <div
      data-active={active ? "" : undefined}
      className={cn(
        "group/session relative flex hit-area w-full items-center gap-2 rounded-md pr-2 pl-2",
        active ? "bg-accent" : "hover:bg-accent/60",
      )}
    >
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left">
        <span className="flex size-5 shrink-0 items-center justify-center">
          <SessionStatusIndicator session={session} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{session.title}</span>
        {session.shared ? <Share2 aria-label="Shared" className="size-3 shrink-0 text-muted-foreground" /> : null}
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Archive session"
        onClick={(event) => {
          event.stopPropagation()
          onArchive()
        }}
        className="shrink-0 opacity-0 group-focus-within/session:opacity-100 group-hover/session:opacity-100 data-[state=open]:opacity-100"
      >
        <Archive />
      </Button>
    </div>
  )
}
