import { X } from "lucide-react"
import { Button } from "@/components/ui/button"

export function FilePreview({ path, content, loading, binary, truncated, totalBytes, error, onClose }: { path?: string; content?: string; loading?: boolean; binary?: boolean; truncated?: boolean; totalBytes?: number; error?: string; onClose?: () => void }) {
  if (!path) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a file to preview it.
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b bg-muted py-1 pl-3 pr-1 font-mono text-xs">
        <span className="min-w-0 flex-1 truncate" title={path}>{path}</span>
        {onClose ? <Button variant="ghost" size="icon-sm" aria-label="Close file preview" onClick={onClose}><X /></Button> : null}
      </div>
      {loading ? <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading file…</div> : null}
      {error ? <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-destructive">{error}</div> : null}
      {binary ? <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Binary files cannot be previewed.</div> : null}
      {!loading && !binary && !error ? <pre tabIndex={0} aria-label="File contents" className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs whitespace-pre-wrap">{content ?? ""}</pre> : null}
      {truncated ? <div className="border-t px-3 py-2 text-xs text-muted-foreground">Preview limited to 256 KiB of {totalBytes ?? "unknown"} bytes.</div> : null}
    </div>
  )
}
