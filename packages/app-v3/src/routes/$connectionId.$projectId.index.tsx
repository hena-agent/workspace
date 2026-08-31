import { useEffect } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { ProjectOverviewView } from "@/features/project/project-overview-view"
import { useConnectionAgent } from "@/connection/provider"
import { RouteLoadingState } from "@/connection/route-state"
import { useCollectionReady, useProject, useReadySessions, useSessions } from "@/data/queries"
import { useMediaQuery } from "@/hooks/use-media-query"
import { recentlySeen } from "@/local-state/seen"
import { SessionList } from "@/shell/session-list"

const DESKTOP_QUERY = "(min-width: 1280px)"

export const Route = createFileRoute("/$connectionId/$projectId/")({
  component: ProjectOverviewRoute,
})

function ProjectOverviewRoute() {
  const { connectionId, projectId } = Route.useParams()
  const navigate = useNavigate()
  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  const agent = useConnectionAgent(connectionId)
  const project = useProject(agent, projectId)
  const sessions = useSessions(agent, projectId)
  const readySessions = useReadySessions(agent, sessions)
  const projectsReady = useCollectionReady(agent, "projects")
  const sessionsReady = useCollectionReady(agent, "sessions")
  const lastSessionId = agent && isDesktop
    ? recentlySeen(agent.url).findLast((id) => readySessions.some((session) => session.id === id))
    : undefined

  useEffect(() => {
    if (!agent || !lastSessionId) return
    void navigate({
      to: "/$connectionId/$projectId/session/$sessionId",
      params: { connectionId, projectId, sessionId: lastSessionId },
      replace: true,
    })
  }, [agent, connectionId, lastSessionId, navigate, projectId])

  if (!project || !sessionsReady) {
    return <RouteLoadingState agent={agent} ready={projectsReady && sessionsReady} missing="Project not found." />
  }

  function startSession() {
    void navigate({
      to: "/$connectionId/$projectId/new/$draftId",
      params: { connectionId, projectId, draftId: `draft-${Date.now()}` },
    })
  }

  if (isDesktop) {
    return <ProjectOverviewView project={project} onNewSession={startSession} />
  }

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-3 pb-4">
        <div className="min-w-0">
          <h1 className="truncate text-[14px] font-medium text-[var(--legacy-text-strong)]">{project.name}</h1>
          <p className="truncate text-[13px] text-[var(--legacy-text-base)]">{project.path}</p>
        </div>
        <Button onClick={startSession} className="legacy-primary-button shrink-0">
          New session
        </Button>
      </div>
      <SessionList
        sessions={readySessions}
        autoFocusSessionId={
          typeof window.history.state?.henaFocusSessionId === "string"
            ? window.history.state.henaFocusSessionId
            : undefined
        }
        mobile
        onSelectSession={(id) => {
          window.history.replaceState({ ...window.history.state, henaFocusSessionId: id }, "")
          void navigate({
            to: "/$connectionId/$projectId/session/$sessionId",
            params: { connectionId, projectId, sessionId: id },
          })
        }}
      />
    </div>
  )
}
