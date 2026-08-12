import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { ReviewView } from "@/features/review/review-view"
import { listDiffFiles } from "@/mock/queries"

export const Route = createFileRoute("/$connectionId/$projectId/session/$sessionId/review")({
  component: ReviewRoute,
})

function ReviewRoute() {
  const { sessionId } = Route.useParams()
  const [activePath, setActivePath] = useState<string | undefined>(undefined)

  return <ReviewView files={listDiffFiles(sessionId)} activePath={activePath} onSelectFile={setActivePath} />
}
