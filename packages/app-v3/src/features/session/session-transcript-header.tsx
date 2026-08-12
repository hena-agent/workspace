import { Archive, GitFork, MoreHorizontal, Share2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { Session } from "@/lib/types"

export function SessionTranscriptHeader({
  session,
  onShare,
  onFork,
  onArchive,
}: {
  session: Session
  onShare: () => void
  onFork: () => void
  onArchive: () => void
}) {
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-background/95 px-4 py-2.5 backdrop-blur-sm md:px-5">
      <h1 className="min-w-0 truncate text-sm font-semibold">{session.title}</h1>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Session actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onShare}>
            <Share2 /> {session.shared ? "Copy share link" : "Share"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onFork}>
            <GitFork /> Fork
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onArchive} variant="destructive">
            <Archive /> Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
