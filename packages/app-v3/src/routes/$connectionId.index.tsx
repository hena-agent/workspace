import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { LegacyHomeView } from "@/features/home/legacy-home-view"
import { useMockServers } from "@/features/server/mock-server-provider"
import { MOCK_NOW } from "@/mock/fixtures"
import { listProjects } from "@/mock/queries"

export const Route = createFileRoute("/$connectionId/")({
  component: ServerHomeRoute,
})

function ServerHomeRoute() {
  const { connectionId } = Route.useParams()
  const navigate = useNavigate()
  const servers = useMockServers()
  const server = servers.getServerBySlug(connectionId)
  const projects = listProjects(server?.id).toSorted((a, b) => b.updatedAt - a.updatedAt)

  if (!server) {
    return <div className="flex size-full items-center justify-center text-sm text-muted-foreground">Server not found.</div>
  }

  return (
    <LegacyHomeView
      connection={server}
      projects={projects}
      now={MOCK_NOW}
      onOpenProject={(project) => {
        void navigate({ to: "/$connectionId/$projectId", params: { connectionId, projectId: project.id } })
      }}
      onAddProject={() => {}}
    />
  )
}
