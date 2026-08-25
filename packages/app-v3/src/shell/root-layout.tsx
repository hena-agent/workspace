import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react"
import { Outlet, useLocation, useNavigate, useParams } from "@tanstack/react-router"
import { CommandPalette } from "@/features/command-palette/command-palette"
import { useConnectionAgent, useServers } from "@/connection/provider"
import type { ProbeResult } from "@/connection/probe"
import { ConnectionStateBanner } from "@/connection/route-state"
import { Button } from "@/components/ui/button"
import { ServerSelectionModal } from "@/features/server/server-selection-modal"
import { decodeServerSlug } from "@/lib/server-url"
import type { Project } from "@/lib/types"
import { projectNotification, useProject, useProjects, useSessions } from "@/data/queries"
import { AppShell } from "./app-shell"

const DRAFT_INSTANCE_ID = Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(36)).join(
  "-",
)

export function RootLayout() {
  const pathname = useLocation({ select: (location) => location.pathname })
  if (pathname === "/connect") return <Outlet />
  return <ConnectionGate><ShellLayout /></ConnectionGate>
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
  const params = useParams({ strict: false }) as {
    connectionId?: string
    projectId?: string
    sessionId?: string
  }
  const servers = useServers()
  const agent = useConnectionAgent(params.connectionId)
  const connection = servers.getServerBySlug(params.connectionId)
  const [paletteOpen, setPaletteOpen] = useState(false)
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

  const projects = useProjects(agent).map((project) => ({ ...project, connectionId: connection?.url ?? "" }))
  const project = useProject(agent, params.projectId)
  const serverSessions = useSessions(agent)
  const projectSessions = serverSessions.filter((session) => session.projectId === project?.id)

  function goToProject(target: Project) {
    const server = servers.connections.find((candidate) => candidate.url === target.connectionId)
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
           notification: projectNotification(item.id, serverSessions),
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
        now,
        onSelectSession: (id) => {
          if (!params.connectionId || !params.projectId) return
          void navigate({
            to: "/$connectionId/$projectId/session/$sessionId",
            params: { connectionId: params.connectionId, projectId: params.projectId, sessionId: id },
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
      <ConnectionStateBanner agent={agent} />
      <Outlet />
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
