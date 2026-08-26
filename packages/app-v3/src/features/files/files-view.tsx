import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import type { FileNode } from "@/lib/types"
import { FilePreview } from "./file-preview"
import { FileTree } from "./file-tree"

export function FilesView({
  tree,
  activePath,
  onSelectFile,
  content,
  loading,
  binary,
  truncated,
  totalBytes,
  error,
  onExpand,
  search,
  searchResults,
  searchLoading,
  searchError,
  onSearch,
}: {
  tree: FileNode[]
  activePath?: string
  onSelectFile: (path: string) => void
  content?: string
  loading?: boolean
  binary?: boolean
  truncated?: boolean
  totalBytes?: number
  error?: string
  onExpand?: (path: string) => Promise<FileNode[]>
  search?: string
  searchResults?: string[]
  searchLoading?: boolean
  searchError?: boolean
  onSearch?: (value: string) => void
}) {
  const finding = Boolean(search?.trim())
  return (
    <div className="flex h-full flex-col md:flex-row">
      <ScrollArea className="h-[40dvh] shrink-0 border-b md:h-auto md:w-64 md:border-r md:border-b-0">
        <div className="flex flex-col gap-2 p-2">
          {onSearch ? <Input aria-label="Find in project" placeholder="Find in project" value={search} onChange={(event) => onSearch(event.target.value)} /> : null}
          {finding ? (
            <div aria-live="polite" className="flex flex-col gap-0.5">
              {searchLoading ? <p className="px-2 py-1 text-xs text-muted-foreground">Searching...</p> : null}
              {searchError ? <p className="px-2 py-1 text-xs text-destructive">Search is unavailable.</p> : null}
              {!searchLoading && !searchError && searchResults?.length === 0 ? <p className="px-2 py-1 text-xs text-muted-foreground">No matching files.</p> : null}
              {searchResults?.map((path) => (
                <button key={path} type="button" className="hit-area truncate rounded px-2 py-1 text-left text-xs hover:bg-accent" title={path} onClick={() => onSelectFile(path)}>{path}</button>
              ))}
            </div>
          ) : <FileTree nodes={tree} activePath={activePath} onSelectFile={onSelectFile} onExpand={onExpand} />}
        </div>
      </ScrollArea>
      <div className="min-h-0 flex-1">
        <FilePreview path={activePath} content={content} loading={loading} binary={binary} truncated={truncated} totalBytes={totalBytes} error={error} />
      </div>
    </div>
  )
}
