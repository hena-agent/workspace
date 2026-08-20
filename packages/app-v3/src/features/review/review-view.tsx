import { ScrollArea } from "@/components/ui/scroll-area"
import type { DiffFile } from "@/lib/types"
import { DiffFileRow } from "./diff-file-row"
import { DiffView } from "./diff-view"

export function ReviewView({
  files,
  activePath,
  onSelectFile,
}: {
  files: DiffFile[]
  activePath?: string
  onSelectFile: (path: string) => void
}) {
  if (files.length === 0) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No changes yet.</div>
  }

  const active = files.find((file) => file.path === activePath) ?? files[0]

  return (
    <div className="flex h-full flex-col md:flex-row">
      <ScrollArea className="h-[40dvh] shrink-0 border-b md:h-auto md:w-64 md:border-r md:border-b-0">
        <ul aria-label="Changed files" className="flex flex-col gap-0.5 p-2">
          {files.map((file) => (
            <li key={file.path}>
              <DiffFileRow file={file} active={file.path === active.path} onSelect={() => onSelectFile(file.path)} />
            </li>
          ))}
        </ul>
      </ScrollArea>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3">
          <DiffView file={active} />
        </div>
      </ScrollArea>
    </div>
  )
}
