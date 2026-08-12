import { SquarePen } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { Project } from "@/lib/types"

export function ProjectOverviewView({ project, onNewSession }: { project: Project; onNewSession: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div>
        <h1 className="text-lg font-semibold">{project.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{project.path}</p>
      </div>
      <Button onClick={onNewSession} className="hit-area">
        <SquarePen /> New session
      </Button>
    </div>
  )
}
