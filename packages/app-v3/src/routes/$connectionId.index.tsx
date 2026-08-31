import { useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { LegacyHomeView } from "@/features/home/legacy-home-view"
import { useConnectionAgent, useServers } from "@/connection/provider"
import { useProjects, useReadySessions, useSessions } from "@/data/queries"
import { recentlySeen } from "@/local-state/seen"
import { useMediaQuery } from "@/hooks/use-media-query"

const DESKTOP_QUERY = "(min-width: 1280px)"

export const Route = createFileRoute("/$connectionId/")({
  component: ServerHomeRoute,
})

function ServerHomeRoute() {
  const { connectionId } = Route.useParams()
  const navigate = useNavigate()
  const servers = useServers()
  const server = servers.getServerBySlug(connectionId)
  const agent = useConnectionAgent(connectionId)
  const projects = useProjects(agent)
  const sessions = useSessions(agent)
  const readySessions = useReadySessions(agent, sessions)
  const [now] = useState(Date.now)
  const isDesktop = useMediaQuery(DESKTOP_QUERY)

  if (!server) {
    return <div className="flex size-full items-center justify-center text-sm text-muted-foreground">Server not found.</div>
  }

  return (
    <LegacyHomeView
      connection={server}
      projects={projects}
      now={now}
      onOpenProject={async (project) => {
        const sessionId = agent && isDesktop
          ? recentlySeen(agent.url).findLast((id) =>
              readySessions.some((session) => session.id === id && session.projectId === project.id))
          : undefined
        if (!agent || !sessionId) {
          await navigate({ to: "/$connectionId/$projectId", params: { connectionId, projectId: project.id } })
          return
        }
        await navigate({
          to: "/$connectionId/$projectId/session/$sessionId",
          params: { connectionId, projectId: project.id, sessionId },
        })
      }}
    />
  )
}
