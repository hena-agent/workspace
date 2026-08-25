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
  onExpand,
}: {
  node: FileNode
  depth: number
  activePath?: string
  onSelectFile: (path: string) => void
  onExpand?: (path: string) => Promise<FileNode[]>
}) {
  const [openOverride, setOpenOverride] = useState<boolean>()
  const [loadedChildren, setLoadedChildren] = useState<FileNode[]>()
  const [loading, setLoading] = useState(false)
  const open = openOverride ?? Boolean(node.children)
  const children = node.children ?? loadedChildren

  async function toggle() {
    const next = !open
    setOpenOverride(next)
    if (!next || children || !onExpand) return
    setLoading(true)
    setLoadedChildren(await onExpand(node.path).finally(() => setLoading(false)))
  }

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
        onClick={toggle}
        aria-expanded={open}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        className="flex hit-area w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs hover:bg-accent/60"
      >
        <ChevronRight aria-hidden className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        <Folder aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{baseName(node.path)}</span>
        {loading ? <span className="text-muted-foreground">Loading...</span> : null}
      </button>
      {open
        ? <ul role="list">
            {children?.map((child) => (
              <li key={child.path}>
                <FileTreeNode
                  node={child}
                  depth={depth + 1}
                  activePath={activePath}
                  onSelectFile={onSelectFile}
                  onExpand={onExpand}
                />
              </li>
            ))}
          </ul>
        : null}
    </div>
  )
}
