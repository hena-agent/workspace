export function FilePreview({ path, content, loading, binary, truncated, totalBytes, error }: { path?: string; content?: string; loading?: boolean; binary?: boolean; truncated?: boolean; totalBytes?: number; error?: string }) {
  if (!path) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a file to preview it.
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b bg-muted px-3 py-1.5 font-mono text-xs">{path}</div>
      {loading ? <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading file…</div> : null}
      {error ? <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-destructive">{error}</div> : null}
      {binary ? <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Binary files cannot be previewed.</div> : null}
      {!loading && !binary && !error ? <pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs whitespace-pre-wrap">{content ?? ""}</pre> : null}
      {truncated ? <div className="border-t px-3 py-2 text-xs text-muted-foreground">Preview limited to 256 KiB of {totalBytes ?? "unknown"} bytes.</div> : null}
    </div>
  )
}
