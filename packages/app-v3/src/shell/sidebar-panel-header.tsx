import { useState } from "react"
import { Ellipsis } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import type { Project } from "@/lib/types"

export function SidebarPanelHeader({
  project,
  onRename,
  onClearNotifications,
  onClose,
}: {
  project: Project
  onRename: (name: string) => void
  onClearNotifications: () => void
  onClose: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(project.name)

  function commit() {
    const trimmed = draft.trim()
    setEditing(false)
    if (trimmed && trimmed !== project.name) {
      onRename(trimmed)
      return
    }
    setDraft(project.name)
  }

  return (
    <div className="flex items-start justify-between gap-2 px-3 py-3">
      <div className="min-w-0 flex-1">
        {editing ? (
          <Input
            autoFocus
            aria-label="Project name"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit()
              if (event.key === "Escape") {
                setDraft(project.name)
                setEditing(false)
              }
            }}
            className="h-6 px-1 text-sm font-medium"
          />
        ) : (
          <button
            type="button"
            onDoubleClick={() => setEditing(true)}
            className="block max-w-full truncate text-left text-sm font-medium"
          >
            {project.name}
          </button>
        )}
        <p className="truncate text-xs text-muted-foreground" title={project.path}>
          {project.path}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Project actions">
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditing(true)}>Rename</DropdownMenuItem>
          <DropdownMenuItem onSelect={onClearNotifications}>Clear notifications</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onClose}>
            Close project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
