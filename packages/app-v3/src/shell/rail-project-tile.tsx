import { Loader2 } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { Project } from "@/lib/types"
import type { ProjectNotification } from "@/mock/queries"

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
  selected,
  notification,
  onSelect,
}: {
  project: Project
  selected: boolean
  notification: ProjectNotification
  onSelect: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-pressed={selected}
          aria-label={project.name}
          onClick={onSelect}
          className={cn(
            "relative flex size-10 shrink-0 cursor-default items-center justify-center overflow-hidden rounded-[8px] p-1 transition-colors",
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
      <TooltipContent side="right">{project.name}</TooltipContent>
    </Tooltip>
  )
}
