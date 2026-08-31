import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Session } from "@/lib/types"
import { LegacyIcon } from "./legacy-icon"

function SessionStatusIndicator({ session }: { session: Session }) {
  if (session.status === "working") {
    return <Loader2 className="size-[15px] animate-spin" aria-label="Working" />
  }
  if (session.status === "permission" || session.status === "question") {
    return <span aria-label="Needs your input" className="size-1.5 rounded-full bg-[var(--legacy-warning)]" />
  }
  if (session.status === "error") {
    return <span aria-label="Error" className="size-1.5 rounded-full bg-[var(--legacy-critical)]" />
  }
  if (session.unread) {
    return <span aria-label="Unread" className="size-1.5 rounded-full bg-[var(--legacy-text-interactive)]" />
  }
  return null
}

export function SessionListItem({
  session,
  active,
  autoFocus = false,
  mobile,
  onSelect,
  onArchive,
}: {
  session: Session
  active: boolean
  autoFocus?: boolean
  mobile: boolean
  onSelect: () => void
  onArchive?: () => void
}) {
  const hasStatus = session.status !== "idle" || session.unread

  return (
    <div
      data-active={active ? "true" : "false"}
      className={cn(
        "group/session relative w-full min-w-0 cursor-default rounded-[6px] pr-3 pl-2 transition-colors duration-75 focus-within:bg-[var(--legacy-surface-raised-hover)] hover:bg-[var(--legacy-surface-raised-hover)]",
        active && "bg-[var(--legacy-surface-active)]",
      )}
    >
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          autoFocus={autoFocus}
          onClick={onSelect}
          className="flex hit-area min-w-0 flex-1 items-center gap-2 py-1 text-left outline-none"
        >
          {hasStatus ? (
            <span className="flex size-6 shrink-0 items-center justify-center text-[var(--legacy-text-interactive)]">
              <SessionStatusIndicator session={session} />
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-[14px] leading-[25px] text-[var(--legacy-text-strong)]">
            {session.title}
          </span>
        </button>
        {onArchive ? <div
          className={cn(
            "w-[var(--hit-area)] shrink-0 transition-opacity duration-75",
            mobile
              ? "opacity-100"
              : "pointer-events-none opacity-0 group-focus-within/session:pointer-events-auto group-focus-within/session:opacity-100 group-hover/session:pointer-events-auto group-hover/session:opacity-100",
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label="Archive session"
            onClick={(event) => {
              event.stopPropagation()
              onArchive()
            }}
            className="legacy-small-icon-button hit-area"
          >
            <LegacyIcon name="archive" className="size-4" />
          </Button>
        </div> : null}
      </div>
    </div>
  )
}
