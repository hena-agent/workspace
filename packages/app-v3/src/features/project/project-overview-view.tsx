import { Button } from "@/components/ui/button"
import type { Project } from "@/lib/types"
import { LegacyIcon } from "@/shell/legacy-icon"

export function ProjectOverviewView({ project, onNewSession }: { project: Project; onNewSession: () => void }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div>
        <h1 className="text-[14px] font-medium text-[var(--legacy-text-strong)]">{project.name}</h1>
        <p className="mt-1 text-[13px] text-[var(--legacy-text-base)]">{project.path}</p>
      </div>
      <Button onClick={onNewSession} className="legacy-primary-button h-8">
        <LegacyIcon name="edit" className="size-4" /> New session
      </Button>
    </div>
  )
}
