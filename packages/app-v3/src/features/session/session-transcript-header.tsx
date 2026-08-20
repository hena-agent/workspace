import { useLayoutEffect, useRef } from "react"
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
  const headingRef = useRef<HTMLHeadingElement>(null)

  useLayoutEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[var(--legacy-border-weaker)] bg-[var(--legacy-background-base)] px-4 py-2.5 md:px-5">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="min-w-0 truncate text-[14px] font-medium text-[var(--legacy-text-strong)] outline-none"
      >
        {session.title}
      </h1>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Session actions" className="legacy-small-icon-button">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onShare}>
            <Share2 /> {session.shared ? "Copy share link" : "Share"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onFork}>
            <GitFork /> Fork
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onArchive}>
            <Archive /> Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
