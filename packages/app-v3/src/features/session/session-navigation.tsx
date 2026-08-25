import { Link } from "@tanstack/react-router"

export function SessionNavigation({
  connectionId,
  projectId,
  sessionId,
}: {
  connectionId: string
  projectId: string
  sessionId: string
}) {
  const params = { connectionId, projectId, sessionId }
  const className = "rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
  const activeProps = { className: "bg-accent text-foreground" }
  return (
    <nav aria-label="Session views" className="flex shrink-0 items-center gap-1 border-b px-3 py-1.5">
      <Link to="/$connectionId/$projectId/session/$sessionId" params={params} activeOptions={{ exact: true }} className={className} activeProps={activeProps}>Transcript</Link>
      <Link to="/$connectionId/$projectId/session/$sessionId/files" params={params} search={{ file: undefined }} className={className} activeProps={activeProps}>Files</Link>
      <Link to="/$connectionId/$projectId/session/$sessionId/review" params={params} search={{ file: undefined }} className={className} activeProps={activeProps}>Review</Link>
    </nav>
  )
}
