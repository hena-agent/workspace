import type { FileNode } from "@/lib/types"
import { FileTreeNode } from "./file-tree-node"

export function FileTree({
  nodes,
  activePath,
  onSelectFile,
  onExpand,
}: {
  nodes: FileNode[]
  activePath?: string
  onSelectFile: (path: string) => void
  onExpand?: (path: string) => Promise<FileNode[]>
}) {
  return (
    <ul role="list" aria-label="Files" className="flex flex-col gap-0.5">
      {nodes.map((node) => (
        <li key={node.path}>
          <FileTreeNode node={node} depth={0} activePath={activePath} onSelectFile={onSelectFile} onExpand={onExpand} />
        </li>
      ))}
    </ul>
  )
}
