import { FolderPlus, Inbox as InboxIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatRelativeTime } from "@/lib/time"
import type { Project } from "@/lib/types"
import type { InboxItem } from "@/mock/queries"
import { InboxRequestRow } from "./inbox-request-row"

export function InboxView({
  items,
  recentProjects,
  now,
  onOpenItem,
  onOpenProject,
  onAddProject,
}: {
  items: InboxItem[]
  recentProjects: Project[]
  now: number
  onOpenItem: (item: InboxItem) => void
  onOpenProject: (projectId: string) => void
  onAddProject: () => void
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 md:p-8">
      <div>
        <h1 className="text-lg font-semibold">Inbox</h1>
        <p className="text-sm text-muted-foreground">Requests that need you, across every project.</p>
      </div>

      {items.length > 0 ? (
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <InboxRequestRow key={item.id} item={item} now={now} onOpen={() => onOpenItem(item)} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
          <InboxIcon aria-hidden className="size-6" />
          <p>Nothing needs you right now.</p>
        </div>
      )}

      {recentProjects.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Recent projects</h2>
            <Button variant="ghost" size="sm" onClick={onAddProject}>
              <FolderPlus /> Open project
            </Button>
          </div>
          <ul className="flex flex-col gap-1">
            {recentProjects.map((project) => (
              <li key={project.id}>
                <button
                  type="button"
                  onClick={() => onOpenProject(project.id)}
                  className="flex hit-area w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-accent/60"
                >
                  <span className="truncate">{project.path}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatRelativeTime(project.updatedAt, now)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
