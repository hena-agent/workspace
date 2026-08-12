import type { FileNode } from "@/lib/types"
import { FileTreeNode } from "./file-tree-node"

export function FileTree({
  nodes,
  activePath,
  onSelectFile,
}: {
  nodes: FileNode[]
  activePath?: string
  onSelectFile: (path: string) => void
}) {
  return (
    <div role="tree" aria-label="Files" className="flex flex-col gap-0.5">
      {nodes.map((node) => (
        <FileTreeNode key={node.path} node={node} depth={0} activePath={activePath} onSelectFile={onSelectFile} />
      ))}
    </div>
  )
}
