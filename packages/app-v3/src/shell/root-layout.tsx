import { useEffect, useState } from "react"
import { Outlet, useNavigate, useParams } from "@tanstack/react-router"
import { CommandPalette } from "@/features/command-palette/command-palette"
import type { Project } from "@/lib/types"
import { MOCK_NOW, sessions } from "@/mock/fixtures"
import { getProject, getProjectNotificationState, listProjects, listServerCommands, listSessions } from "@/mock/queries"
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
  const projects = listProjects()
  const project = connectionId && projectId ? getProject({ id: projectId, connectionId }) : undefined
  const projectSessions = project ? listSessions({ projectId: project.id, connectionId: project.connectionId }) : []

  function goToProject(target: Project) {
    void navigate({
      to: "/$connectionId/$projectId",
      params: { connectionId: target.connectionId, projectId: target.id },
    })
  }

  function runAfterMobileNavClose(action: () => void) {
    if (!window.history.state?.henaMobileNavigation) {
      action()
      return
    }
    window.addEventListener("popstate", action, { once: true })
    window.history.back()
  }

  return (
    <AppShell
      rail={{
        projects: projects.map((item) => ({
          project: item,
          notification: getProjectNotificationState({ projectId: item.id, connectionId: item.connectionId }),
        })),
        selectedProject: project,
        onSelectProject: goToProject,
        onAddProject: () => {},
        onOpenSettings: () => void navigate({ to: "/settings/$section", params: { section: "general" } }),
      }}
      sidebarPanel={{
        project,
        sessions: projectSessions,
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
        sessions={sessions.filter((session) => !session.archived)}
        serverCommands={listServerCommands()}
        onSelectProject={(target) => runAfterMobileNavClose(() => goToProject(target))}
        onSelectSession={(session) =>
          runAfterMobileNavClose(() =>
            void navigate({
              to: "/$connectionId/$projectId/session/$sessionId",
              params: { connectionId: session.connectionId, projectId: session.projectId, sessionId: session.id },
            }),
          )
        }
        onRunServerCommand={() => runAfterMobileNavClose(() => {})}
        onOpenSettings={() =>
          runAfterMobileNavClose(() => void navigate({ to: "/settings/$section", params: { section: "general" } }))
        }
      />
    </AppShell>
  )
}
