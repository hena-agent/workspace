import { Server, Settings } from "lucide-react"
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
import type { Connection, Project, ServerCommand, Session } from "@/lib/types"

export function CommandPalette({
  open,
  onOpenChange,
  projects,
  sessions,
  serverCommands,
  connections = [],
  onSelectProject,
  onSelectSession,
  onRunServerCommand,
  onSelectConnection,
  onOpenSettings,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: Project[]
  sessions: Session[]
  serverCommands: ServerCommand[]
  connections?: Connection[]
  onSelectProject: (project: Project) => void
  onSelectSession: (session: Session) => void
  onRunServerCommand: (command: ServerCommand) => void
  onSelectConnection?: (connection: Connection) => void
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
                key={`${project.connectionId}:${project.id}`}
                value={`project ${project.connectionId} ${project.id} ${project.name} ${project.path}`}
                onSelect={() => {
                  onSelectProject(project)
                  onOpenChange(false)
                }}
              >
                {projects.some((other) => other !== project && other.name === project.name)
                  ? `${project.name} (${project.path}, ${project.connectionId})`
                  : project.name}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Sessions">
            {sessions.map((session) => {
              const project = projects.find(
                (candidate) =>
                  candidate.id === session.projectId && candidate.connectionId === session.connectionId,
              )
              return (
                <CommandItem
                  key={`${session.connectionId}:${session.projectId}:${session.id}`}
                  value={`session ${session.connectionId} ${session.projectId} ${session.id} ${session.title} ${project?.path ?? ""}`}
                  onSelect={() => {
                    onSelectSession(session)
                    onOpenChange(false)
                  }}
                >
                  {sessions.some((other) => other !== session && other.title === session.title)
                    ? `${session.title} (${project?.path ?? session.projectId}, ${session.connectionId}, ${session.id})`
                    : session.title}
                </CommandItem>
              )
            })}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Servers">
            {connections.map((connection) => (
              <CommandItem
                key={connection.url}
                value={`server ${connection.name} ${connection.url}`}
                onSelect={() => {
                  onSelectConnection?.(connection)
                  onOpenChange(false)
                }}
              >
                <Server /> {connection.name}
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
            {serverCommands.length === 0 ? <CommandItem disabled>No server commands available.</CommandItem> : null}
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
