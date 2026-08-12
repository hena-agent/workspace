import { SquarePen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { Project, Session } from "@/lib/types"
import { SessionList } from "./session-list"
import { SidebarPanelHeader } from "./sidebar-panel-header"

export function SidebarPanel({
  project,
  sessions,
  activeSessionId,
  now,
  onSelectSession,
  onArchiveSession,
  onNewSession,
  onRenameProject,
  onClearNotifications,
  onCloseProject,
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
}) {
  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center text-sm text-muted-foreground">
        <p>Select a project to see its sessions.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <SidebarPanelHeader
        project={project}
        onRename={onRenameProject}
        onClearNotifications={onClearNotifications}
        onClose={onCloseProject}
      />
      <div className="px-3 pb-3">
        <Button className="hit-area w-full justify-start" onClick={onNewSession}>
          <SquarePen /> New session
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <SessionList
          sessions={sessions}
          activeSessionId={activeSessionId}
          now={now}
          onSelectSession={onSelectSession}
          onArchiveSession={onArchiveSession}
        />
      </ScrollArea>
    </div>
  )
}
