import { createFileRoute, Navigate } from "@tanstack/react-router"
import { useMockServers } from "@/features/server/mock-server-provider"

export const Route = createFileRoute("/")({
  component: HomeRoute,
})

function HomeRoute() {
  const servers = useMockServers()
  const server = servers.connections[0]
  if (!server) return null
  return <Navigate to="/$connectionId" params={{ connectionId: servers.getSlug(server) }} replace />
}
