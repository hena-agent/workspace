import { Button } from "@/components/ui/button"
import type { Project, Session } from "@/lib/types"
import { SessionList } from "./session-list"
import { SidebarPanelHeader } from "./sidebar-panel-header"
import { LegacyIcon } from "./legacy-icon"

export function SidebarPanel({
  project,
  sessions,
  activeSessionId,
  onSelectSession,
  onArchiveSession,
  onNewSession,
  onRenameProject,
  onClearNotifications,
  onCloseProject,
  width,
  mobile = false,
}: {
  project?: Project
  sessions: Session[]
  activeSessionId?: string
  now: number
  onSelectSession: (sessionId: string) => void
  onArchiveSession: (sessionId: string) => void
  onNewSession: () => void
  onRenameProject: (name: string) => void
  onClearNotifications: () => void
  onCloseProject: () => void
  width?: number
  mobile?: boolean
}) {
  return (
    <div
      className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-tl-[12px] border-t border-l border-[var(--legacy-border-weaker)] bg-[var(--legacy-background-base)] px-3"
      style={{ width: mobile ? undefined : width, flex: mobile ? "1 1 0%" : undefined }}
    >
      {project ? (
        <>
          <SidebarPanelHeader
            project={project}
            onRename={onRenameProject}
            onClearNotifications={onClearNotifications}
            onClose={onCloseProject}
          />
          <div className="shrink-0 py-4">
            <Button className="legacy-primary-button h-8 w-full text-[13px]" onClick={onNewSession}>
              <LegacyIcon name="edit" className="size-4" /> New session
            </Button>
          </div>
          <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto py-2 [overflow-anchor:none]">
            <SessionList
              sessions={sessions}
              activeSessionId={activeSessionId}
              mobile={mobile}
              onSelectSession={onSelectSession}
              onArchiveSession={onArchiveSession}
            />
          </div>
        </>
      ) : (
        <div className="-mt-4 flex min-h-0 flex-1 items-center justify-center px-6 pb-64 text-center">
          <div className="mt-8 flex max-w-60 flex-col items-center gap-3">
            <div className="text-[14px] font-medium text-[var(--legacy-text-strong)]">Open a project</div>
            <div className="text-[14px] leading-5 text-[var(--legacy-text-base)]">
              Choose a project to see its sessions.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
