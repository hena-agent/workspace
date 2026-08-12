import { Settings } from "lucide-react"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import type { Project, ServerCommand, Session } from "@/lib/types"

export function CommandPalette({
  open,
  onOpenChange,
  projects,
  sessions,
  serverCommands,
  onSelectProject,
  onSelectSession,
  onRunServerCommand,
  onOpenSettings,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: Project[]
  sessions: Session[]
  serverCommands: ServerCommand[]
  onSelectProject: (projectId: string) => void
  onSelectSession: (session: Session) => void
  onRunServerCommand: (command: ServerCommand) => void
  onOpenSettings: () => void
}) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search projects, sessions, and commands"
    >
      <Command>
        <CommandInput placeholder="Search projects, sessions, and commands…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Projects">
            {projects.map((project) => (
              <CommandItem
                key={project.id}
                value={`project ${project.name} ${project.path}`}
                onSelect={() => {
                  onSelectProject(project.id)
                  onOpenChange(false)
                }}
              >
                {project.name}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Sessions">
            {sessions.map((session) => (
              <CommandItem
                key={session.id}
                value={`session ${session.title}`}
                onSelect={() => {
                  onSelectSession(session)
                  onOpenChange(false)
                }}
              >
                {session.title}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Commands">
            {serverCommands.map((command) => (
              <CommandItem
                key={command.id}
                value={`command ${command.name} ${command.description}`}
                onSelect={() => {
                  onRunServerCommand(command)
                  onOpenChange(false)
                }}
              >
                {command.name}
              </CommandItem>
            ))}
            <CommandItem
              value="open settings"
              onSelect={() => {
                onOpenSettings()
                onOpenChange(false)
              }}
            >
              <Settings /> Open settings
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
