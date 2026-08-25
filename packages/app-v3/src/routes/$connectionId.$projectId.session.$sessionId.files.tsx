import { useEffect, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { FilesView } from "@/features/files/files-view"
import { SessionNavigation } from "@/features/session/session-navigation"
import { useConnectionAgent } from "@/connection/provider"
import { RouteLoadingState } from "@/connection/route-state"
import { loadFileDirectory, loadFileMatches, useCollectionReady, useFileContent, useFileTree, useSession, useSessionLocation } from "@/data/queries"

export const Route = createFileRoute("/$connectionId/$projectId/session/$sessionId/files")({
  validateSearch: (search: Record<string, unknown>) => ({
    file: typeof search.file === "string" && search.file.length <= 1024 ? search.file : undefined,
  }),
  component: FilesRoute,
  remountDeps: ({ params }) => params,
})

function FilesRoute() {
  const { connectionId, projectId, sessionId } = Route.useParams()
  const { file } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const queryClient = useQueryClient()
  const agent = useConnectionAgent(connectionId)
  const session = useSession(agent, sessionId)
  const location = useSessionLocation(agent, sessionId)
  const tree = useFileTree(agent, location)
  const content = useFileContent(agent, location, file)
  const sessionsReady = useCollectionReady(agent, "sessions")
  const [search, setSearch] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  useEffect(() => {
    const timeout = setTimeout(() => setSearchQuery(search.trim()), 150)
    return () => clearTimeout(timeout)
  }, [search])
  const matches = useQuery({
    queryKey: [agent?.url, "fs.find", location?.directory, location?.workspaceID, searchQuery],
    enabled: Boolean(agent && location && searchQuery),
    queryFn: ({ signal }) => agent && location ? loadFileMatches(agent, location, searchQuery, signal) : [],
  })

  if (!session || session.projectId !== projectId) {
    return <RouteLoadingState agent={agent} ready={sessionsReady} missing="Session not found." />
  }

  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      <SessionNavigation connectionId={connectionId} projectId={projectId} sessionId={sessionId} />
      <div className="min-h-0 flex-1">
        <FilesView
          tree={tree.data ?? []}
          activePath={file}
          content={content.data && "text" in content.data ? content.data.text : undefined}
          binary={Boolean(content.data && "binary" in content.data)}
          truncated={Boolean(content.data && "truncated" in content.data && content.data.truncated)}
          totalBytes={content.data?.totalBytes}
          error={tree.isError ? "Files are unavailable for this location." : content.isError ? "This file is unavailable." : undefined}
          loading={tree.isLoading || content.isLoading}
          search={search}
          searchResults={matches.data}
          searchLoading={matches.isLoading && Boolean(searchQuery)}
          searchError={matches.isError}
          onSearch={setSearch}
          onExpand={(path) => {
            if (!agent || !location) return Promise.resolve([])
            return queryClient.fetchQuery({
              queryKey: [agent.url, "fs.list", location.directory, location.workspaceID, path],
              queryFn: ({ signal }) => loadFileDirectory(agent, location, path, signal),
            })
          }}
          onSelectFile={(path) => void navigate({ search: { file: path } })}
        />
      </div>
    </div>
  )
}
