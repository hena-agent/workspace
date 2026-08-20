import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { ReviewView } from "@/features/review/review-view"
import { getSession, listDiffFiles } from "@/mock/queries"

export const Route = createFileRoute("/$connectionId/$projectId/session/$sessionId/review")({
  component: ReviewRoute,
  remountDeps: ({ params }) => params,
})

function ReviewRoute() {
  const { connectionId, projectId, sessionId } = Route.useParams()
  const [activePath, setActivePath] = useState<string | undefined>(undefined)

  if (!getSession({ id: sessionId, connectionId, projectId })) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Session not found.</div>
    )
  }

  return (
    <ReviewView
      files={listDiffFiles({ sessionId, connectionId, projectId })}
      activePath={activePath}
      onSelectFile={setActivePath}
    />
  )
}
