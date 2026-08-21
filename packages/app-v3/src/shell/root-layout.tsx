import { useEffect, useRef, useState } from "react"
import { Outlet, useNavigate, useParams } from "@tanstack/react-router"
import { CommandPalette } from "@/features/command-palette/command-palette"
import { useMockServers } from "@/features/server/mock-server-provider"
import { ServerSelectionModal } from "@/features/server/server-selection-modal"
import { decodeServerSlug } from "@/lib/server-url"
import type { Project } from "@/lib/types"
import { MOCK_NOW } from "@/mock/fixtures"
import { getProject, getProjectNotificationState, listProjects, listServerCommands, listSessions } from "@/mock/queries"
import { AppShell } from "./app-shell"

const DRAFT_INSTANCE_ID = crypto.randomUUID()

export function RootLayout() {
  const navigate = useNavigate()
  const params = useParams({ strict: false }) as {
    connectionId?: string
    projectId?: string
    sessionId?: string
  }
  const servers = useMockServers()
  const connection = servers.getServerBySlug(params.connectionId)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const draftSequence = useRef(0)

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

  const projects = connection ? listProjects(connection.id) : []
  const project = connection && params.projectId ? getProject({ id: params.projectId, connectionId: connection.id }) : undefined
  const projectSessions = project ? listSessions({ projectId: project.id, connectionId: project.connectionId }) : []
  const serverSessions = connection ? listSessions({ connectionId: connection.id }) : []

  function goToProject(target: Project) {
    const server = servers.connections.find((candidate) => candidate.id === target.connectionId)
    if (!server) return
    void navigate({
      to: "/$connectionId/$projectId",
      params: { connectionId: servers.getSlug(server), projectId: target.id },
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
        onOpenSettings: () => {
          if (!params.connectionId) return
          void navigate({
            to: "/$connectionId/settings/$section",
            params: { connectionId: params.connectionId, section: "general" },
          })
        },
      }}
      sidebarPanel={{
        project,
        sessions: projectSessions,
        activeSessionId: params.sessionId,
        now: MOCK_NOW,
        onSelectSession: (id) => {
          if (!params.connectionId || !params.projectId) return
          void navigate({
            to: "/$connectionId/$projectId/session/$sessionId",
            params: { connectionId: params.connectionId, projectId: params.projectId, sessionId: id },
          })
        },
        onArchiveSession: () => {},
        onNewSession: () => {
          if (!params.connectionId || !params.projectId) return
          draftSequence.current += 1
          void navigate({
            to: "/$connectionId/$projectId/new/$draftId",
            params: {
              connectionId: params.connectionId,
              projectId: params.projectId,
              draftId: `draft-${DRAFT_INSTANCE_ID}-${draftSequence.current}`,
            },
          })
        },
        onRenameProject: () => {},
        onClearNotifications: () => {},
        onCloseProject: () => {
          if (!params.connectionId) return
          void navigate({ to: "/$connectionId", params: { connectionId: params.connectionId } })
        },
      }}
      titlebarActions={
        <ServerSelectionModal
          current={connection}
          pendingUrl={connection ? undefined : decodeServerSlug(params.connectionId ?? "")}
          onSelect={(server) => {
            const connectionId = servers.getSlug(server)
            if (params.connectionId === connectionId) return
            void navigate({ to: "/$connectionId", params: { connectionId } })
          }}
        />
      }
    >
      <Outlet />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        projects={projects}
        sessions={serverSessions.filter((session) => !session.archived)}
        serverCommands={listServerCommands()}
        onSelectProject={(target) => runAfterMobileNavClose(() => goToProject(target))}
        onSelectSession={(session) =>
          runAfterMobileNavClose(() => {
            if (!params.connectionId) return
            void navigate({
              to: "/$connectionId/$projectId/session/$sessionId",
              params: {
                connectionId: params.connectionId,
                projectId: session.projectId,
                sessionId: session.id,
              },
            })
          })
        }
        onRunServerCommand={() => runAfterMobileNavClose(() => {})}
        onOpenSettings={() =>
          runAfterMobileNavClose(() => {
            if (!params.connectionId) return
            void navigate({
              to: "/$connectionId/settings/$section",
              params: { connectionId: params.connectionId, section: "general" },
            })
          })
        }
      />
    </AppShell>
  )
}
