import { useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { LegacyHomeView } from "@/features/home/legacy-home-view"
import { useConnectionAgent, useServers } from "@/connection/provider"
import { useProjects } from "@/data/queries"

export const Route = createFileRoute("/$connectionId/")({
  component: ServerHomeRoute,
})

function ServerHomeRoute() {
  const { connectionId } = Route.useParams()
  const navigate = useNavigate()
  const servers = useServers()
  const server = servers.getServerBySlug(connectionId)
  const projects = useProjects(useConnectionAgent(connectionId))
  const [now] = useState(Date.now)

  if (!server) {
    return <div className="flex size-full items-center justify-center text-sm text-muted-foreground">Server not found.</div>
  }

  return (
    <LegacyHomeView
      connection={server}
      projects={projects}
      now={now}
      onOpenProject={(project) => {
        void navigate({ to: "/$connectionId/$projectId", params: { connectionId, projectId: project.id } })
      }}
    />
  )
}
