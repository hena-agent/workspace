import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { NewSessionView } from "@/features/new-session/new-session-view"
import { getProject, listAgents, listModels, listSessions } from "@/mock/queries"

export const Route = createFileRoute("/$connectionId/$projectId/new/$draftId")({
  component: NewSessionRoute,
})

function NewSessionRoute() {
  const { connectionId, projectId } = Route.useParams()
  const navigate = useNavigate()
  const project = getProject(projectId)

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
        // The UI shell has no server to admit a prompt against, so "starting"
        // a draft jumps to an existing session for the project (the flagship
        // transcript as a fallback) to keep the flow browsable end to end.
        const existing = listSessions({ projectId }).at(0)?.id ?? "sess-transcript"
        void navigate({
          to: "/$connectionId/$projectId/session/$sessionId",
          params: { connectionId, projectId, sessionId: existing },
        })
      }}
    />
  )
}
