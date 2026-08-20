import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { Project } from "@/lib/types"
import { getProjectNotificationState } from "@/mock/queries"
import { RailProjectTile } from "./rail-project-tile"
import { LegacyIcon } from "./legacy-icon"

export function Rail({
  projects,
  selectedProjectId,
  onSelectProject,
  onAddProject,
  onOpenSettings,
  className,
}: {
  projects: Project[]
  selectedProjectId?: string
  onSelectProject: (projectId: string) => void
  onAddProject: () => void
  onOpenSettings: () => void
  className?: string
}) {
  return (
    <nav
      aria-label="Projects"
      className={cn(
        "flex h-full w-16 shrink-0 flex-col items-center overflow-hidden bg-[var(--legacy-background-base)]",
        className,
      )}
    >
      <div className="no-scrollbar flex h-full w-full flex-col items-center gap-3 overflow-y-auto px-3 py-3">
        {projects.map((project) => (
          <RailProjectTile
            key={project.id}
            project={project}
            selected={project.id === selectedProjectId}
            notification={getProjectNotificationState(project.id)}
            onSelect={() => onSelectProject(project.id)}
          />
        ))}
        <RailAction label="Open project" onClick={onAddProject}>
          <LegacyIcon name="plus" />
        </RailAction>
      </div>
      <div className="flex w-full shrink-0 flex-col items-center gap-2 pt-3 pb-6">
        <RailAction label="Settings" onClick={onOpenSettings}>
          <LegacyIcon name="settings-gear" />
        </RailAction>
      </div>
    </nav>
  )
}

function RailAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} onClick={onClick} className="legacy-rail-action">
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}
