import type { Session } from "@/lib/types"
import { SessionListItem } from "./session-list-item"

export function SessionList({
  sessions,
  activeSessionId,
  mobile = false,
  onSelectSession,
  onArchiveSession,
}: {
  sessions: Session[]
  activeSessionId?: string
  mobile?: boolean
  onSelectSession: (sessionId: string) => void
  onArchiveSession: (sessionId: string) => void
}) {
  if (sessions.length === 0) {
    return <div className="px-2 py-3 text-[13px] text-[var(--legacy-text-weak)]">No sessions yet</div>
  }

  return (
    <nav aria-label="Sessions" className="flex flex-col gap-1">
      {sessions.map((session) => (
        <SessionListItem
          key={session.id}
          session={session}
          active={session.id === activeSessionId}
          mobile={mobile}
          onSelect={() => onSelectSession(session.id)}
          onArchive={() => onArchiveSession(session.id)}
        />
      ))}
    </nav>
  )
}
