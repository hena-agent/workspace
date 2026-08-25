import { createFileRoute, Navigate } from "@tanstack/react-router"
import { useServers } from "@/connection/provider"

export const Route = createFileRoute("/")({
  component: HomeRoute,
})

function HomeRoute() {
  const servers = useServers()
  const server = servers.connections[0]
  if (!server) return <Navigate to="/connect" replace />
  return <Navigate to="/$connectionId" params={{ connectionId: servers.getSlug(server) }} replace />
}
