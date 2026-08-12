import { groupSessionsByRecency } from "@/mock/queries"
import type { Session } from "@/lib/types"
import { SessionListItem } from "./session-list-item"

const GROUP_LABEL = { today: "Today", yesterday: "Yesterday", older: "Older" } as const
const GROUP_ORDER = ["today", "yesterday", "older"] as const

export function SessionList({
  sessions,
  activeSessionId,
  now,
  onSelectSession,
  onArchiveSession,
}: {
  sessions: Session[]
  activeSessionId?: string
  now: number
  onSelectSession: (sessionId: string) => void
  onArchiveSession: (sessionId: string) => void
}) {
  if (sessions.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 py-12 text-center text-sm text-muted-foreground">
        <p>No sessions yet.</p>
      </div>
    )
  }

  const groups = groupSessionsByRecency(sessions, now)

  return (
    <nav aria-label="Sessions" className="flex flex-col gap-3 px-2 pb-3">
      {GROUP_ORDER.map((key) => {
        const items = groups[key]
        if (items.length === 0) return null
        return (
          <div key={key} className="flex flex-col gap-0.5">
            <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">{GROUP_LABEL[key]}</h3>
            {items.map((session) => (
              <SessionListItem
                key={session.id}
                session={session}
                active={session.id === activeSessionId}
                onSelect={() => onSelectSession(session.id)}
                onArchive={() => onArchiveSession(session.id)}
              />
            ))}
          </div>
        )
      })}
    </nav>
  )
}
