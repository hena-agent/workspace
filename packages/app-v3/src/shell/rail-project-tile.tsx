import { Loader2 } from "lucide-react"
import type { KeyboardEvent } from "react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { Project, ProjectNotification } from "@/lib/types"

const AVATAR_COLOR_CLASS: Record<NonNullable<Project["color"]>, string> = {
  pink: "bg-pink-500/20 text-pink-200",
  mint: "bg-emerald-500/20 text-emerald-200",
  orange: "bg-orange-500/20 text-orange-200",
  purple: "bg-purple-500/20 text-purple-200",
  cyan: "bg-cyan-500/20 text-cyan-200",
  lime: "bg-lime-500/20 text-lime-200",
}

const NOTIFICATION_CLASS: Record<ProjectNotification["kind"], string> = {
  none: "",
  unread: "bg-[var(--legacy-text-interactive)]",
  permission: "bg-[var(--legacy-warning)]",
  error: "bg-[var(--legacy-critical)]",
}

export function RailProjectTile({
  project,
  label,
  selected,
  notification,
  onSelect,
  onKeyDown,
  grabbed,
  dragging,
  descriptionId,
}: {
  project: Project
  label: string
  selected: boolean
  notification: ProjectNotification
  onSelect: () => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
  grabbed: boolean
  dragging: boolean
  descriptionId: string
}) {
  const accessibleLabel = [
    label,
    notification.kind === "unread" ? "unread" : undefined,
    notification.kind === "permission" ? "needs your input" : undefined,
    notification.kind === "error" ? "error" : undefined,
    notification.working ? "working" : undefined,
  ]
    .filter(Boolean)
    .join(", ")

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-pressed={selected}
          aria-describedby={descriptionId}
          aria-roledescription="sortable project"
          aria-label={accessibleLabel}
          onClick={onSelect}
          onKeyDown={onKeyDown}
          className={cn(
            "relative flex size-10 min-h-[var(--hit-area)] min-w-[var(--hit-area)] shrink-0 items-center justify-center overflow-hidden rounded-[8px] p-1 transition-colors",
            dragging ? "cursor-grabbing" : "cursor-default",
            grabbed && "ring-2 ring-[var(--legacy-icon-strong)]",
            selected
              ? "border-2 border-[var(--legacy-icon-strong)]"
              : "border border-transparent hover:border-[var(--legacy-border-weak)] hover:bg-[var(--legacy-surface-hover)]",
          )}
        >
          <Avatar className="size-8 rounded-[4px]">
            <AvatarFallback
              className={cn(
                "rounded-[4px] text-[13px] font-medium uppercase",
                AVATAR_COLOR_CLASS[project.color ?? "cyan"],
              )}
            >
              {project.name.slice(0, 2)}
            </AvatarFallback>
          </Avatar>
          {notification.kind !== "none" ? (
            <span
              aria-hidden
              className={cn(
                "absolute top-px right-px z-10 size-1.5 rounded-full",
                NOTIFICATION_CLASS[notification.kind],
              )}
            />
          ) : null}
          {notification.working ? (
            <span className="absolute right-px bottom-px z-10 flex size-3 items-center justify-center rounded-full bg-[var(--legacy-background-base)]">
              <Loader2 className="size-[9px] animate-spin text-[var(--legacy-icon-base)]" />
            </span>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}
