import { useState } from "react"
import { ChevronRight, File, Folder } from "lucide-react"
import { cn } from "@/lib/utils"
import type { FileNode } from "@/lib/types"

function baseName(path: string) {
  return path.split("/").pop() ?? path
}

export function FileTreeNode({
  node,
  depth,
  activePath,
  onSelectFile,
}: {
  node: FileNode
  depth: number
  activePath?: string
  onSelectFile: (path: string) => void
}) {
  // The mock tree is small, so every directory starts expanded to show the
  // full structure at a glance; a real (much larger) tree would default deep
  // levels to collapsed instead.
  const [open, setOpen] = useState(true)

  if (node.type === "file") {
    const active = node.path === activePath
    return (
      <button
        type="button"
        onClick={() => onSelectFile(node.path)}
        aria-current={active ? "true" : undefined}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        className={cn(
          "flex hit-area w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs",
          active ? "bg-accent" : "hover:bg-accent/60",
        )}
      >
        <File aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{baseName(node.path)}</span>
      </button>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        className="flex hit-area w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs hover:bg-accent/60"
      >
        <ChevronRight aria-hidden className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        <Folder aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{baseName(node.path)}</span>
      </button>
      {open
        ? node.children?.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              onSelectFile={onSelectFile}
            />
          ))
        : null}
    </div>
  )
}
