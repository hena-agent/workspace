import { useState } from "react"
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
import { LegacyIcon } from "./legacy-icon"

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
    <div className="shrink-0 py-1 pl-1">
      <div className="group/project flex items-start justify-between gap-2 py-2 pr-0 pl-2">
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
              className="h-6 rounded px-1 text-[14px] font-medium"
            />
          ) : (
            <button
              type="button"
              onDoubleClick={() => setEditing(true)}
              className="block max-w-full truncate text-left text-[14px] leading-[21px] font-medium text-[var(--legacy-text-strong)]"
            >
              {project.name}
            </button>
          )}
          <p
            className="truncate text-[13px] leading-[19.5px] text-[var(--legacy-text-base)] select-text"
            title={project.path}
          >
            {project.path}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Project actions" className="legacy-small-icon-button">
              <LegacyIcon name="dot-grid" className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-max whitespace-nowrap">
            <DropdownMenuItem onSelect={() => setEditing(true)}>Edit</DropdownMenuItem>
            <DropdownMenuItem>Enable workspaces</DropdownMenuItem>
            <DropdownMenuItem onSelect={onClearNotifications}>Clear notifications</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onClose}>Close</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
