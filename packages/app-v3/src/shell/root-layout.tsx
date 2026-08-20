import { useEffect, useState } from "react"
import { Outlet, useNavigate, useParams } from "@tanstack/react-router"
import { CommandPalette } from "@/features/command-palette/command-palette"
import { MOCK_NOW, sessions as allSessions } from "@/mock/fixtures"
import { getProject, listProjects, listServerCommands, listSessions } from "@/mock/queries"
import { AppShell } from "./app-shell"

export function RootLayout() {
  const navigate = useNavigate()
  const params = useParams({ strict: false }) as {
    connectionId?: string
    projectId?: string
    sessionId?: string
  }
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const { connectionId, projectId, sessionId } = params
  const projects = listProjects(connectionId)
  const project = projectId ? getProject(projectId) : undefined
  const sessions = project ? listSessions({ projectId: project.id }) : []

  function goToProject(id: string) {
    const target = getProject(id)
    if (!target) return
    void navigate({ to: "/$connectionId/$projectId", params: { connectionId: target.connectionId, projectId: id } })
  }

  return (
    <AppShell
      rail={{
        projects,
        selectedProjectId: projectId,
        onSelectProject: goToProject,
        onAddProject: () => {},
        onOpenSettings: () => void navigate({ to: "/settings/$section", params: { section: "general" } }),
      }}
      sidebarPanel={{
        project,
        sessions,
        activeSessionId: sessionId,
        now: MOCK_NOW,
        onSelectSession: (id) => {
          if (!connectionId || !projectId) return
          void navigate({
            to: "/$connectionId/$projectId/session/$sessionId",
            params: { connectionId, projectId, sessionId: id },
          })
        },
        onArchiveSession: () => {},
        onNewSession: () => {
          if (!connectionId || !projectId) return
          void navigate({
            to: "/$connectionId/$projectId/new/$draftId",
            params: { connectionId, projectId, draftId: `draft-${Date.now()}` },
          })
        },
        onRenameProject: () => {},
        onClearNotifications: () => {},
        onCloseProject: () => void navigate({ to: "/" }),
      }}
    >
      <Outlet />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        projects={projects}
        sessions={allSessions.filter((session) => !session.archived)}
        serverCommands={listServerCommands()}
        onSelectProject={goToProject}
        onSelectSession={(session) =>
          void navigate({
            to: "/$connectionId/$projectId/session/$sessionId",
            params: { connectionId: session.connectionId, projectId: session.projectId, sessionId: session.id },
          })
        }
        onRunServerCommand={() => {}}
        onOpenSettings={() => void navigate({ to: "/settings/$section", params: { section: "general" } })}
      />
    </AppShell>
  )
}
