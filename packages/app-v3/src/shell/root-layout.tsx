import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react"
import { Outlet, useLocation, useNavigate, useParams } from "@tanstack/react-router"
import { PanelRightClose, PanelRightOpen } from "lucide-react"
import { CommandPalette } from "@/features/command-palette/command-palette"
import { useConnectionAgent, useServers } from "@/connection/provider"
import type { ProbeResult } from "@/connection/probe"
import { ConnectionStateBanner } from "@/connection/route-state"
import { Button } from "@/components/ui/button"
import { AddProjectModal } from "@/features/project/add-project-modal"
import { SessionFilesProvider, useSessionFiles } from "@/features/session/session-files-panel"
import { ServerSelectionModal } from "@/features/server/server-selection-modal"
import { decodeServerSlug } from "@/lib/server-url"
import type { Project } from "@/lib/types"
import { projectNotification, useProject, useProjects, useSessions } from "@/data/queries"
import { archiveSessionOptimistically } from "@/mutations/session"
import { applyProjectOrder, loadProjectOrder, saveProjectOrder } from "@/local-state/project-order"
import { AppShell } from "./app-shell"

const DRAFT_INSTANCE_ID = Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(36)).join(
  "-",
)

export function RootLayout() {
  const pathname = useLocation({ select: (location) => location.pathname })
  if (pathname === "/connect") return <Outlet />
  return <SessionFilesProvider><ConnectionGate><ShellLayout /></ConnectionGate></SessionFilesProvider>
}

function ConnectionGate({ children }: { children: ReactNode }) {
  const params = useParams({ strict: false }) as { connectionId?: string }
  const servers = useServers()
  const resolution = params.connectionId ? servers.resolveSlug(params.connectionId) : undefined
  const [probe, setProbe] = useState<ProbeResult>()
  const [adding, setAdding] = useState(false)
  const diagnoseServer = useEffectEvent((url: string) => servers.diagnoseServer(url))
  const resolutionKind = resolution?.kind
  const resolutionUrl = resolution && "url" in resolution ? resolution.url : undefined

  useEffect(() => {
    if (!resolutionUrl || resolutionKind === "registered" || resolutionKind === "malformed") return
    let active = true
    void diagnoseServer(resolutionUrl).then((result) => {
      if (active) setProbe(result)
    })
    return () => { active = false }
  }, [resolutionKind, resolutionUrl])

  if (!resolution || resolution.kind === "registered") return children
  if (resolution.kind === "malformed") return <ConnectionGateState title="Invalid server link" detail="This address is not a valid canonical server URL." />

  async function register() {
    if (!resolution || !("url" in resolution)) return
    setAdding(true)
    const result = await servers.addServer(resolution.url)
    setProbe(result.probe)
    setAdding(false)
  }

  return (
    <ConnectionGateState
      title={resolution.kind === "tombstoned" ? "You removed this server" : "Connect to this server?"}
      detail={`${resolution.url}\n${probe?.message ?? "Checking compatibility..."}`}
      action={probe?.status === "reachable" ? (
        <Button onClick={() => void register()} disabled={adding}>
          {adding ? "Adding server..." : resolution.kind === "tombstoned" ? "Re-add server" : "Add server"}
        </Button>
      ) : undefined}
    />
  )
}

function ConnectionGateState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-[var(--legacy-background-base)] p-6">
      <section className="w-full max-w-lg rounded-xl border border-[var(--legacy-border-weak)] bg-background p-6">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-3 whitespace-pre-line break-all text-sm text-muted-foreground">{detail}</p>
        {action ? <div className="mt-6">{action}</div> : null}
      </section>
    </main>
  )
}

function ShellLayout() {
  const navigate = useNavigate()
  const search = useLocation({ select: (location) => location.search })
  const params = useParams({ strict: false }) as {
    connectionId?: string
    projectId?: string
    sessionId?: string
    draftId?: string
  }
  const servers = useServers()
  const agent = useConnectionAgent(params.connectionId)
  const connection = servers.getServerBySlug(params.connectionId)
  const sessionFiles = useSessionFiles()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [addProjectOpen, setAddProjectOpen] = useState(false)
  const [projectOrders, setProjectOrders] = useState<Record<string, string[]>>({})
  const [now] = useState(Date.now)
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

  const syncedProjects = useProjects(agent)
  const draftDirectory = !params.projectId && params.draftId && typeof search.directory === "string"
    ? search.directory
    : undefined
  const draftProject = draftDirectory && connection
    ? {
        id: `draft:${params.draftId}`,
        connectionId: connection.url,
        name: draftDirectory.split(/[\\/]/).filter(Boolean).at(-1) || draftDirectory,
        path: draftDirectory,
        updatedAt: now,
      }
    : undefined
  const storedProjectOrder = connection ? loadProjectOrder(connection.url) : []
  const projectOrder = connection && storedProjectOrder.length > 0
    ? projectOrders[connection.url] ?? storedProjectOrder
    : storedProjectOrder
  const projects = applyProjectOrder(draftProject ? [...syncedProjects, draftProject] : syncedProjects, projectOrder)
  const project = useProject(agent, params.projectId) ?? draftProject
  const serverSessions = useSessions(agent)
  const projectSessions = serverSessions.filter((session) => session.projectId === project?.id)

  function goToProject(target: Project) {
    if (target.id === draftProject?.id) return
    const server = servers.connections.find((candidate) => candidate.url === target.connectionId)
    if (!server) return
    const connectionId = servers.getSlug(server)
    void navigate({
      to: "/$connectionId/$projectId",
      params: { connectionId, projectId: target.id },
    })
  }

  function reorderProjects(next: Project[]) {
    if (!connection) return
    const persisted = next.filter((item) => item.id !== draftProject?.id)
    saveProjectOrder(connection.url, persisted)
    setProjectOrders((current) => ({ ...current, [connection.url]: next.map((item) => item.id) }))
  }

  async function startNewProject(input: string) {
    if (!params.connectionId || !agent) throw new Error("The server is unavailable.")
    const response = await agent.client.api.fs.resolve.$get({ query: { path: input } })
    const result = await response.json()
    if (!response.ok) {
      const message = "error" in result && "message" in result.error && typeof result.error.message === "string"
        ? result.error.message
        : "The directory could not be opened."
      throw new Error(message)
    }
    if (!("directory" in result) || typeof result.directory !== "string")
      throw new Error("The server returned an invalid directory.")
    draftSequence.current += 1
    const existing = syncedProjects.find((candidate) => candidate.path === result.directory)
    if (existing) {
      await navigate({
        to: "/$connectionId/$projectId/new/$draftId",
        params: {
          connectionId: params.connectionId,
          projectId: existing.id,
          draftId: `draft-${DRAFT_INSTANCE_ID}-${draftSequence.current}`,
        },
      })
      return
    }
    await navigate({
      to: "/$connectionId/new/$draftId",
      params: { connectionId: params.connectionId, draftId: `draft-${DRAFT_INSTANCE_ID}-${draftSequence.current}` },
      search: { directory: result.directory },
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
           notification: projectNotification(item.id, serverSessions),
        })),
        selectedProject: project,
        onSelectProject: goToProject,
        onReorderProjects: reorderProjects,
        onAddProject: () => setAddProjectOpen(true),
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
        now,
        onSelectSession: (id) => {
          if (!params.connectionId || !params.projectId) return
          void navigate({
            to: "/$connectionId/$projectId/session/$sessionId",
            params: { connectionId: params.connectionId, projectId: params.projectId, sessionId: id },
          })
        },
        onArchiveSession: (id) => {
          if (!agent) return
          void archiveSessionOptimistically(agent, id).catch(() => {})
          if (params.sessionId !== id || !params.connectionId || !params.projectId) return
          void navigate({
            to: "/$connectionId/$projectId",
            params: { connectionId: params.connectionId, projectId: params.projectId },
          })
        },
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
        <>
          <ServerSelectionModal
            current={connection}
            pendingUrl={connection ? undefined : decodeServerSlug(params.connectionId ?? "")}
            onSelect={(server) => {
              const connectionId = servers.getSlug(server)
              if (params.connectionId === connectionId) return
              void navigate({ to: "/$connectionId", params: { connectionId } })
            }}
          />
          {params.sessionId ? <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle file tree"
            aria-expanded={sessionFiles.open}
            aria-controls="file-tree-panel"
            onClick={() => sessionFiles.setOpen(!sessionFiles.open)}
            className="legacy-titlebar-button hidden md:inline-flex"
          >
            {sessionFiles.open ? <PanelRightClose /> : <PanelRightOpen />}
          </Button> : null}
        </>
      }
    >
      <ConnectionStateBanner agent={agent} />
      <Outlet />
      <AddProjectModal open={addProjectOpen} onOpenChange={setAddProjectOpen} onSubmit={startNewProject} />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        projects={projects}
        sessions={serverSessions.filter((session) => !session.archived)}
        serverCommands={[]}
        connections={servers.connections}
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
        onSelectConnection={(server) => runAfterMobileNavClose(() => {
          void navigate({ to: "/$connectionId", params: { connectionId: servers.getSlug(server) } })
        })}
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
