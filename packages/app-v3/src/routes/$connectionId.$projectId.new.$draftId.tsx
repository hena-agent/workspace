import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { NewSessionView } from "@/features/new-session/new-session-view"
import { useMockServers } from "@/features/server/mock-server-provider"
import { getProject, listAgents, listModels, listSessions } from "@/mock/queries"

export const Route = createFileRoute("/$connectionId/$projectId/new/$draftId")({
  component: NewSessionRoute,
  remountDeps: ({ params }) => params,
})

function NewSessionRoute() {
  const { connectionId, projectId } = Route.useParams()
  const navigate = useNavigate()
  const server = useMockServers().getServerBySlug(connectionId)
  const project = server ? getProject({ id: projectId, connectionId: server.id }) : undefined

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Project not found.</div>
    )
  }

  return (
    <NewSessionView
      project={project}
      agents={listAgents()}
      models={listModels()}
      onStart={() => {
        const existing = listSessions({ projectId, connectionId: project.connectionId }).at(0)
        if (!existing) {
          void navigate({ to: "/$connectionId/$projectId", params: { connectionId, projectId } })
          return
        }
        void navigate({
          to: "/$connectionId/$projectId/session/$sessionId",
          params: { connectionId, projectId, sessionId: existing.id },
        })
      }}
    />
  )
}
