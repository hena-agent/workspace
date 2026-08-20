import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { FilesView } from "@/features/files/files-view"
import { getFileTree, getSession } from "@/mock/queries"

export const Route = createFileRoute("/$connectionId/$projectId/session/$sessionId/files")({
  component: FilesRoute,
  remountDeps: ({ params }) => params,
})

function FilesRoute() {
  const { connectionId, projectId, sessionId } = Route.useParams()
  const [activePath, setActivePath] = useState<string | undefined>(undefined)

  if (!getSession({ id: sessionId, connectionId, projectId })) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Session not found.</div>
    )
  }

  return <FilesView tree={getFileTree()} activePath={activePath} onSelectFile={setActivePath} />
}
