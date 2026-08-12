import { Loader2 } from "lucide-react"
import { Avatar, AvatarBadge, AvatarFallback } from "@/components/ui/avatar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { Project } from "@/lib/types"
import type { ProjectNotification } from "@/mock/queries"

const AVATAR_COLOR_CLASS: Record<NonNullable<Project["color"]>, string> = {
  pink: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
  mint: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  orange: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  purple: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  cyan: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
  lime: "bg-lime-500/15 text-lime-600 dark:text-lime-400",
}

const NOTIFICATION_BADGE_CLASS: Record<ProjectNotification["kind"], string> = {
  none: "",
  unread: "bg-blue-500",
  permission: "bg-amber-500",
  error: "bg-destructive",
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
            "relative flex size-11 hit-area shrink-0 items-center justify-center rounded-full border transition-colors",
            selected ? "border-foreground/60 bg-transparent" : "border-transparent hover:border-border hover:bg-accent",
          )}
        >
          <Avatar>
            <AvatarFallback className={cn("font-semibold uppercase", AVATAR_COLOR_CLASS[project.color ?? "cyan"])}>
              {project.name.slice(0, 2)}
            </AvatarFallback>
            {notification.kind !== "none" ? (
              <AvatarBadge aria-hidden className={NOTIFICATION_BADGE_CLASS[notification.kind]} />
            ) : null}
            {notification.working ? (
              <span className="absolute -right-0.5 -bottom-0.5 flex size-3 items-center justify-center rounded-full bg-background">
                <Loader2 className="size-2.5 animate-spin text-muted-foreground" />
              </span>
            ) : null}
          </Avatar>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{project.name}</TooltipContent>
    </Tooltip>
  )
}
