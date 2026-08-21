import { Button } from "@/components/ui/button"
import { formatRelativeTime } from "@/lib/time"
import type { Connection, Project } from "@/lib/types"
import { LegacyIcon } from "@/shell/legacy-icon"

export function LegacyHomeView({
  connection,
  projects,
  now,
  onOpenProject,
  onAddProject,
}: {
  connection: Connection
  projects: Project[]
  now: number
  onOpenProject: (project: Project) => void
  onAddProject: () => void
}) {
  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="mx-auto mt-[220px] w-full px-4 pb-8 md:w-auto">
        <LegacyLogo />
        <Button
          variant="ghost"
          className="mx-auto mt-4 h-8 hit-area text-[14px] font-normal text-[var(--legacy-text-weak)]"
        >
          <span className="size-2 rounded-full bg-[var(--legacy-border-weak)]" />
          {connection.name}
        </Button>
        <div className="mt-20 flex w-full flex-col gap-4">
          <div className="flex items-center justify-between gap-2 pl-3">
            <h1 className="text-[14px] font-medium text-[var(--legacy-text-strong)]">Recent projects</h1>
            <Button className="legacy-primary-button h-7 pr-3 pl-2 text-[13px]" onClick={onAddProject}>
              <LegacyIcon name="folder-add-left" className="size-4" /> Open project
            </Button>
          </div>
          <ul className="flex flex-col gap-2">
            {projects.slice(0, 5).map((project) => (
              <li key={`${project.connectionId}:${project.id}`}>
                <Button
                  variant="ghost"
                  className="h-8 hit-area w-full justify-between px-3 font-mono text-[14px] font-normal text-[var(--legacy-text-strong)]"
                  onClick={() => onOpenProject(project)}
                >
                  {project.path}
                  <span className="font-sans text-[14px] text-[var(--legacy-text-weak)]">
                    {formatRelativeTime(project.updatedAt, now)}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function LegacyLogo() {
  return (
    <svg viewBox="0 0 114 42" fill="none" className="w-full opacity-12 md:w-xl" aria-label="Hena">
      <path d="M0 3H6V15H18V3H24V39H18V21H6V39H0V3Z" fill="var(--legacy-icon-base)" />
      <path d="M30 3H54V9H36V18H51V24H36V33H54V39H30V3Z" fill="var(--legacy-icon-base)" />
      <path d="M60 3H66L78 27V3H84V39H78L66 15V39H60V3Z" fill="var(--legacy-icon-strong)" />
      <path d="M96 3H108L114 9V39H108V24H96V39H90V9L96 3ZM96 18H108V9H96V18Z" fill="var(--legacy-icon-strong)" />
    </svg>
  )
}
