import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { LegacyHomeView } from "@/features/home/legacy-home-view"
import { MOCK_NOW } from "@/mock/fixtures"
import { listProjects } from "@/mock/queries"

export const Route = createFileRoute("/")({
  component: HomeRoute,
})

function HomeRoute() {
  const navigate = useNavigate()
  const projects = listProjects().toSorted((a, b) => b.updatedAt - a.updatedAt)

  return (
    <LegacyHomeView
      projects={projects}
      now={MOCK_NOW}
      onOpenProject={(project) =>
        void navigate({
          to: "/$connectionId/$projectId",
          params: { connectionId: project.connectionId, projectId: project.id },
        })
      }
      onAddProject={() => {}}
    />
  )
}
