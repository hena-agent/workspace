import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { FilesView } from "@/features/files/files-view"
import { getFileTree } from "@/mock/queries"

export const Route = createFileRoute("/$connectionId/$projectId/session/$sessionId/files")({
  component: FilesRoute,
})

function FilesRoute() {
  const [activePath, setActivePath] = useState<string | undefined>(undefined)

  return <FilesView tree={getFileTree()} activePath={activePath} onSelectFile={setActivePath} />
}
