export function FilePreview({ path }: { path?: string }) {
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
      <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
        <p>File contents load from the server in the real client; this UI shell shows structure only.</p>
      </div>
    </div>
  )
}
