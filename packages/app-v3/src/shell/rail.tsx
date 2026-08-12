import { CircleHelp, Plus, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { getProjectNotificationState } from "@/mock/queries"
import type { Project } from "@/lib/types"
import { RailProjectTile } from "./rail-project-tile"

export function Rail({
  projects,
  selectedProjectId,
  onSelectProject,
  onAddProject,
  onOpenSettings,
  onOpenHelp,
  className,
}: {
  projects: Project[]
  selectedProjectId?: string
  onSelectProject: (projectId: string) => void
  onAddProject: () => void
  onOpenSettings: () => void
  onOpenHelp: () => void
  className?: string
}) {
  return (
    <nav
      aria-label="Projects"
      className={cn("flex h-full w-16 shrink-0 flex-col items-center justify-between py-3", className)}
    >
      <div className="no-scrollbar flex w-full flex-col items-center gap-2 overflow-y-auto px-3">
        {projects.map((project) => (
          <RailProjectTile
            key={project.id}
            project={project}
            selected={project.id === selectedProjectId}
            notification={getProjectNotificationState(project.id)}
            onSelect={() => onSelectProject(project.id)}
          />
        ))}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label="Open project"
              onClick={onAddProject}
              className="hit-area"
            >
              <Plus />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Open project</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex flex-col items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-lg" aria-label="Settings" onClick={onOpenSettings} className="hit-area">
              <Settings />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Settings</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-lg" aria-label="Help" onClick={onOpenHelp} className="hit-area">
              <CircleHelp />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Help</TooltipContent>
        </Tooltip>
      </div>
    </nav>
  )
}
