import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { ReviewView } from "@/features/review/review-view"
import { getSession, listDiffFiles } from "@/mock/queries"

export const Route = createFileRoute("/$connectionId/$projectId/session/$sessionId/review")({
  validateSearch: (search: Record<string, unknown>) => ({
    file: typeof search.file === "string" && search.file.length <= 1024 ? search.file : undefined,
  }),
  component: ReviewRoute,
  remountDeps: ({ params }) => params,
})

function ReviewRoute() {
  const { connectionId, projectId, sessionId } = Route.useParams()
  const { file } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  if (!getSession({ id: sessionId, connectionId, projectId })) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Session not found.</div>
    )
  }

  return (
    <ReviewView
      files={listDiffFiles({ sessionId, connectionId, projectId })}
      activePath={file}
      onSelectFile={(path) => void navigate({ search: { file: path } })}
    />
  )
}
