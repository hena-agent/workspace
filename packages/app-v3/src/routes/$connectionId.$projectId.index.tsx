import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { ProjectOverviewView } from "@/features/project/project-overview-view"
import { getProject } from "@/mock/queries"

export const Route = createFileRoute("/$connectionId/$projectId/")({
  component: ProjectOverviewRoute,
})

function ProjectOverviewRoute() {
  const { connectionId, projectId } = Route.useParams()
  const navigate = useNavigate()
  const project = getProject(projectId)

  if (!project) {
    return <div className="flex h-full w-full items-center justify-center">Project not found.</div>
  }

  return (
    <ProjectOverviewView
      project={project}
      onNewSession={() =>
        navigate({
          to: "/$connectionId/$projectId/new/$draftId",
          params: { connectionId, projectId, draftId: `draft-${Date.now()}` },
        })
      }
    />
  )
}
