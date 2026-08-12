import { ScrollArea } from "@/components/ui/scroll-area"
import type { FileNode } from "@/lib/types"
import { FilePreview } from "./file-preview"
import { FileTree } from "./file-tree"

export function FilesView({
  tree,
  activePath,
  onSelectFile,
}: {
  tree: FileNode[]
  activePath?: string
  onSelectFile: (path: string) => void
}) {
  return (
    <div className="flex h-full flex-col md:flex-row">
      <ScrollArea className="shrink-0 border-b md:w-64 md:border-r md:border-b-0">
        <div className="p-2">
          <FileTree nodes={tree} activePath={activePath} onSelectFile={onSelectFile} />
        </div>
      </ScrollArea>
      <div className="min-h-0 flex-1">
        <FilePreview path={activePath} />
      </div>
    </div>
  )
}
