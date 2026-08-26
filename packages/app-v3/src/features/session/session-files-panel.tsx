import { createContext, useContext, useEffect, useState, type PointerEvent, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useConnectionAgent } from "@/connection/provider"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { loadFileDirectory, loadFileMatches, useFileContent, useFileTree, useSessionLocation } from "@/data/queries"
import { FilePreview } from "@/features/files/file-preview"
import { FileTree } from "@/features/files/file-tree"

const PANEL_MIN = 180

const SessionFilesContext = createContext<{
  open: boolean
  setOpen: (open: boolean) => void
} | undefined>(undefined)

export function SessionFilesProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return <SessionFilesContext value={{ open, setOpen }}>{children}</SessionFilesContext>
}

export function useSessionFiles() {
  const context = useContext(SessionFilesContext)
  if (!context) throw new Error("useSessionFiles must be used within SessionFilesProvider")
  return context
}

function panelMaxWidth() {
  return Math.max(PANEL_MIN, Math.round(window.innerWidth * 0.3))
}

export function SessionFilesPanel({ connectionId, sessionId }: { connectionId: string; sessionId: string }) {
  const agent = useConnectionAgent(connectionId)
  const location = useSessionLocation(agent, sessionId)
  const queryClient = useQueryClient()
  const [file, setFile] = useState<string>()
  const [search, setSearch] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [previewWidth, setPreviewWidth] = useState(() => Math.min(360, panelMaxWidth()))
  const [treeWidth, setTreeWidth] = useState(() => Math.min(280, panelMaxWidth()))
  const [panelMax, setPanelMax] = useState(panelMaxWidth)
  const tree = useFileTree(agent, location)
  const content = useFileContent(agent, location, file)

  useEffect(() => {
    const timeout = setTimeout(() => setSearchQuery(search.trim()), 150)
    return () => clearTimeout(timeout)
  }, [search])

  useEffect(() => {
    function clampPanelWidths() {
      const max = panelMaxWidth()
      setPanelMax(max)
      setPreviewWidth((current) => Math.max(PANEL_MIN, Math.min(max, current)))
      setTreeWidth((current) => Math.max(PANEL_MIN, Math.min(max, current)))
    }
    window.addEventListener("resize", clampPanelWidths)
    return () => window.removeEventListener("resize", clampPanelWidths)
  }, [])

  const matches = useQuery({
    queryKey: [agent?.url, "fs.find", location?.directory, location?.workspaceID, searchQuery],
    enabled: Boolean(agent && location && searchQuery),
    queryFn: ({ signal }) => agent && location ? loadFileMatches(agent, location, searchQuery, signal) : [],
  })

  const expand = (path: string) => {
    if (!agent || !location) return Promise.resolve([])
    return queryClient.fetchQuery({
      queryKey: [agent.url, "fs.list", location.directory, location.workspaceID, path],
      queryFn: ({ signal }) => loadFileDirectory(agent, location, path, signal),
    })
  }
  const finding = Boolean(search.trim())

  return <>
    {file ? <>
      <ResizeHandle label="Resize file preview" width={previewWidth} max={panelMax} onResize={setPreviewWidth} />
      <aside
        id="file-preview-panel"
        aria-label="File preview"
        className="hidden min-h-0 shrink-0 md:block"
        style={{ width: previewWidth }}
      >
        <FilePreview
          path={file}
          content={content.data && "text" in content.data ? content.data.text : undefined}
          binary={Boolean(content.data && "binary" in content.data)}
          truncated={Boolean(content.data && "truncated" in content.data && content.data.truncated)}
          totalBytes={content.data?.totalBytes}
          error={content.isError ? "This file is unavailable." : undefined}
          loading={content.isLoading}
          onClose={() => setFile(undefined)}
        />
      </aside>
    </> : null}
    <ResizeHandle label="Resize file tree" width={treeWidth} max={panelMax} onResize={setTreeWidth} />
    <aside
      id="file-tree-panel"
      aria-label="File tree"
      className="hidden min-h-0 shrink-0 md:block"
      style={{ width: treeWidth }}
    >
      <ScrollArea className="h-full">
        <div className="flex flex-col gap-2 p-2">
          <Input aria-label="Find in project" placeholder="Find in project" value={search} onChange={(event) => setSearch(event.target.value)} />
          {finding ? (
            <div aria-live="polite" className="flex flex-col gap-0.5">
              {matches.isLoading ? <p className="px-2 py-1 text-xs text-muted-foreground">Searching...</p> : null}
              {matches.isError ? <p className="px-2 py-1 text-xs text-destructive">Search is unavailable.</p> : null}
              {!matches.isLoading && !matches.isError && matches.data?.length === 0 ? <p className="px-2 py-1 text-xs text-muted-foreground">No matching files.</p> : null}
              {matches.data?.map((path) => (
                <button key={path} type="button" className="hit-area truncate rounded px-2 py-1 text-left text-xs hover:bg-accent" title={path} onClick={() => setFile(path)}>{path}</button>
              ))}
            </div>
          ) : tree.isLoading ? <p className="px-2 py-1 text-xs text-muted-foreground">Loading files...</p>
            : tree.isError ? <p className="px-2 py-1 text-xs text-destructive">Files are unavailable for this location.</p>
            : <FileTree nodes={tree.data ?? []} activePath={file} onSelectFile={setFile} onExpand={expand} />}
        </div>
      </ScrollArea>
    </aside>
  </>
}

function ResizeHandle({
  label,
  width,
  max,
  onResize,
}: {
  label: string
  width: number
  max: number
  onResize: (width: number) => void
}) {
  function clamp(width: number) {
    return Math.min(max, Math.max(PANEL_MIN, width))
  }

  function startResize(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const startX = event.clientX

    function onPointerMove(nextEvent: globalThis.PointerEvent) {
      onResize(clamp(width + startX - nextEvent.clientX))
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", onPointerUp)
    }

    window.addEventListener("pointermove", onPointerMove)
    window.addEventListener("pointerup", onPointerUp)
  }

  function resizeWithKeyboard(event: { key: string; preventDefault: () => void }) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    if (event.key === "Home") {
      onResize(PANEL_MIN)
      return
    }
    if (event.key === "End") {
      onResize(max)
      return
    }
    onResize(clamp(width + (event.key === "ArrowLeft" ? 10 : -10)))
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={PANEL_MIN}
      aria-valuemax={max}
      aria-valuenow={width}
      onPointerDown={startResize}
      onKeyDown={resizeWithKeyboard}
      className="group/resize relative z-20 -mx-1 hidden w-2 shrink-0 cursor-col-resize touch-none rounded-sm focus-visible:outline-2 focus-visible:outline-[var(--legacy-text-interactive)] md:block"
    >
      <span className="absolute inset-y-0 left-1/2 w-px bg-border transition-colors group-hover/resize:bg-[var(--legacy-border-weak)]" />
    </div>
  )
}
