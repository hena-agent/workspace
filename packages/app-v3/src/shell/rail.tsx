import { Reorder } from "motion/react"
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { Project, ProjectNotification } from "@/lib/types"
import { RailProjectTile } from "./rail-project-tile"
import { LegacyIcon } from "./legacy-icon"

export function Rail({
  projects,
  selectedProject,
  onSelectProject,
  onReorderProjects,
  onAddProject,
  onOpenSettings,
  className,
}: {
  projects: Array<{ project: Project; notification: ProjectNotification }>
  selectedProject?: Project
  onSelectProject: (project: Project) => void
  onReorderProjects: (projects: Project[]) => void
  onAddProject: () => void
  onOpenSettings: () => void
  className?: string
}) {
  const projectKeys = projects.map((item) => projectKey(item.project))
  const projectsByKey = new Map(projects.map((item) => [projectKey(item.project), item.project]))
  const [keyboardDrag, setKeyboardDrag] = useState<{ key: string; initial: string[] } | null>(null)
  const [pointerDrag, setPointerDrag] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState("")
  const instructionsId = useId()
  const draggedProject = useRef<string | null>(null)

  function reorder(keys: string[]) {
    const reordered = keys.flatMap((key) => {
      const project = projectsByKey.get(key)
      return project ? [project] : []
    })
    if (reordered.length === projects.length) onReorderProjects(reordered)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, key: string, label: string) {
    if (!keyboardDrag) {
      if (event.key !== " " || event.repeat) return
      event.preventDefault()
      setKeyboardDrag({ key, initial: projectKeys })
      setAnnouncement(`${label} picked up. Position ${projectKeys.indexOf(key) + 1} of ${projectKeys.length}.`)
      return
    }
    if (keyboardDrag.key !== key) return
    if (event.key === "Escape") {
      event.preventDefault()
      reorder(keyboardDrag.initial)
      setKeyboardDrag(null)
      setAnnouncement(`${label} movement canceled.`)
      return
    }
    if (event.key === " ") {
      event.preventDefault()
      setKeyboardDrag(null)
      setAnnouncement(`${label} dropped. Position ${projectKeys.indexOf(key) + 1} of ${projectKeys.length}.`)
      return
    }
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    const from = projectKeys.indexOf(key)
    const to =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? projectKeys.length - 1
          : Math.max(0, Math.min(projectKeys.length - 1, from + (event.key === "ArrowUp" ? -1 : 1)))
    if (from === to) return
    const next = [...projectKeys]
    next.splice(to, 0, next.splice(from, 1)[0])
    reorder(next)
    setAnnouncement(`${label} moved to position ${to + 1} of ${projectKeys.length}.`)
  }

  return (
    <nav
      aria-label="Projects"
      className={cn(
        "flex h-full w-16 shrink-0 flex-col items-center overflow-hidden bg-[var(--legacy-background-base)]",
        className,
      )}
    >
      <div className="no-scrollbar flex h-full w-full flex-col items-center gap-3 overflow-y-auto px-3 py-3">
        <span id={instructionsId} className="sr-only">
          Press Space to pick up. Use Arrow keys, Home, or End to move. Press Space to drop or Escape to cancel.
        </span>
        <Reorder.Group
          as="div"
          axis="y"
          values={projectKeys}
          onReorder={reorder}
          className="flex w-full flex-col items-center gap-3"
        >
          {projects.map((item) => {
            const key = projectKey(item.project)
            const duplicateName = projects.some(
              (other) => other.project !== item.project && other.project.name === item.project.name,
            )
            return (
              <Reorder.Item
                as="div"
                key={key}
                value={key}
                className="relative shrink-0 touch-pan-x select-none"
                whileDrag={{ scale: 1.08 }}
                onDragStart={() => {
                  draggedProject.current = key
                  setPointerDrag(key)
                  setAnnouncement(`${item.project.name} picked up.`)
                }}
                onDragEnd={() => {
                  setPointerDrag(null)
                  setAnnouncement(
                    `${item.project.name} dropped. Position ${projectKeys.indexOf(key) + 1} of ${projectKeys.length}.`,
                  )
                  window.setTimeout(() => {
                    draggedProject.current = null
                  })
                }}
              >
                <RailProjectTile
                  project={item.project}
                  label={
                    duplicateName
                      ? `${item.project.name} (${item.project.path}, ${item.project.connectionId})`
                      : item.project.name
                  }
                  selected={
                    item.project.id === selectedProject?.id &&
                    item.project.connectionId === selectedProject.connectionId
                  }
                  notification={item.notification}
                  grabbed={keyboardDrag?.key === key}
                  dragging={pointerDrag === key}
                  descriptionId={instructionsId}
                  onSelect={() => {
                    if (draggedProject.current === key) return
                    onSelectProject(item.project)
                  }}
                  onKeyDown={(event) => handleKeyDown(event, key, item.project.name)}
                />
              </Reorder.Item>
            )
          })}
        </Reorder.Group>
        <RailAction label="Open project" onClick={onAddProject}>
          <LegacyIcon name="plus" />
        </RailAction>
        <span aria-live="assertive" aria-atomic="true" className="sr-only">
          {announcement}
        </span>
      </div>
      <div className="flex w-full shrink-0 flex-col items-center gap-2 pt-3 pb-6">
        <RailAction label="Settings" onClick={onOpenSettings}>
          <LegacyIcon name="settings-gear" />
        </RailAction>
      </div>
    </nav>
  )
}

function projectKey(project: Project) {
  return `${project.connectionId}:${project.id}`
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
