import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { InboxView } from "@/features/inbox/inbox-view"
import { MOCK_NOW } from "@/mock/fixtures"
import { getProject, listInboxItems, listProjects } from "@/mock/queries"

export const Route = createFileRoute("/")({
  component: InboxRoute,
})

function InboxRoute() {
  const navigate = useNavigate()
  const items = listInboxItems()
  const recentProjects = listProjects()
    .toSorted((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5)

  return (
    <InboxView
      items={items}
      recentProjects={recentProjects}
      now={MOCK_NOW}
      onOpenItem={(item) => {
        void navigate({
          to: "/$connectionId/$projectId/session/$sessionId",
          params: { connectionId: item.connection.id, projectId: item.project.id, sessionId: item.session.id },
        })
      }}
      onOpenProject={(projectId) => {
        const project = getProject(projectId)
        if (!project) return
        void navigate({ to: "/$connectionId/$projectId", params: { connectionId: project.connectionId, projectId } })
      }}
      onAddProject={() => {}}
    />
  )
}
