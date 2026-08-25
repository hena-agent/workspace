import { createFileRoute } from "@tanstack/react-router"
import { useConnectionAgent } from "@/connection/provider"
import { RouteLoadingState } from "@/connection/route-state"
import { useCollectionReady, useSession } from "@/data/queries"
import { SessionNavigation } from "@/features/session/session-navigation"

export const Route = createFileRoute("/$connectionId/$projectId/session/$sessionId/review")({
  validateSearch: (search: Record<string, unknown>) => ({
    file: typeof search.file === "string" && search.file.length <= 1024 ? search.file : undefined,
  }),
  component: ReviewRoute,
  remountDeps: ({ params }) => params,
})

function ReviewRoute() {
  const { connectionId, projectId, sessionId } = Route.useParams()
  const agent = useConnectionAgent(connectionId)
  const session = useSession(agent, sessionId)
  const sessionsReady = useCollectionReady(agent, "sessions")

  if (!session || session.projectId !== projectId) {
    return <RouteLoadingState agent={agent} ready={sessionsReady} missing="Session not found." />
  }

  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      <SessionNavigation connectionId={connectionId} projectId={projectId} sessionId={sessionId} />
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Review is not supported by this server yet.
      </div>
    </div>
  )
}
