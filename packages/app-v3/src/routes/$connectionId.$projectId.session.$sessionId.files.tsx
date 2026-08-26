import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { FilesView } from "@/features/files/files-view"
import { getFileTree, getSession } from "@/mock/queries"

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

  if (!getSession({ id: sessionId, connectionId, projectId })) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Session not found.</div>
    )
  }

  return (
    <FilesView
      tree={getFileTree()}
      activePath={file}
      onSelectFile={(path) => void navigate({ search: { file: path } })}
    />
  )
}
