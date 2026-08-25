import { createContext, use, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { encodeServerSlug, normalizeServerUrl } from "@/lib/server-url"
import type { Connection } from "@/lib/types"
import { createConnectionAgent, type ConnectionAgent, type Fetcher } from "./agent"
import { probeServer, type ProbeResult } from "./probe"
import { createConnectionRegistry, type ConnectionRecord, type SlugResolution } from "./registry"

type FocusedAgent = { url: string; agent: ConnectionAgent; unsubscribe: () => void }
export type AddServerResult = { connection?: Connection; probe: ProbeResult }
type ConnectionContextValue = {
  connections: Connection[]
  profileOrigin: string
  addServer: (url: string) => Promise<AddServerResult>
  removeServer: (url: string) => boolean
  resolveSlug: (slug: string | undefined) => SlugResolution
  getServerBySlug: (slug: string | undefined) => Connection | undefined
  getSlug: (connection: Connection) => string
  diagnoseServer: (url: string) => Promise<ProbeResult>
  probeConnections: () => Promise<void>
  agent: (slug: string | undefined) => ConnectionAgent | undefined
}

const ConnectionContext = createContext<ConnectionContextValue | undefined>(undefined)

export function ConnectionProvider({ children, embeddedOrigin, fetcher = fetch }: { children: ReactNode; embeddedOrigin?: string; fetcher?: Fetcher }) {
  const profileOrigin = window.location.origin
  const ownUrl = embeddedOrigin ? normalizeServerUrl(embeddedOrigin) : import.meta.env.DEV ? profileOrigin : undefined
  const registry = useRef(createConnectionRegistry({ ownUrl })).current
  const focused = useRef<FocusedAgent | undefined>(undefined)
  const [probes, setProbes] = useState<Record<string, ProbeResult>>({})
  const [, rerender] = useState(0)
  const records = registry.list()

  useEffect(() => {
    void probeConnections()
    const onFocus = () => void probeConnections()
    window.addEventListener("focus", onFocus)
    return () => {
      window.removeEventListener("focus", onFocus)
      focused.current?.unsubscribe()
      focused.current?.agent.dispose()
    }
  }, [])

  function agent(slug: string | undefined) {
    const resolution = registry.resolveSlug(slug)
    if (resolution.kind !== "registered") return
    if (focused.current?.url === resolution.url) return focused.current.agent
    focused.current?.unsubscribe()
    focused.current?.agent.dispose()
    const created = createConnectionAgent(resolution.url, fetcher)
    focused.current = {
      url: resolution.url,
      agent: created,
      unsubscribe: created.subscribe(() => rerender((version) => version + 1)),
    }
    queueMicrotask(() => void created.start())
    return created
  }

  async function diagnose(input: string) {
    return probeServer({
      url: input,
      profileOrigin,
      allowLoopbackHttp: Boolean(embeddedOrigin || import.meta.env.DEV),
      fetcher,
    })
  }

  async function addServer(input: string): Promise<AddServerResult> {
    const probe = await diagnose(input)
    if (probe.status !== "reachable" || !probe.url) return { probe }
    const record = registry.add(probe.url)
    if (!record) return { probe: { ...probe, status: "invalid", message: "This profile has reached its server limit." } }
    setProbes((current) => ({ ...current, [record.url]: probe }))
    rerender((version) => version + 1)
    return { connection: connection(record, focused.current, probe, ownUrl), probe }
  }

  async function probeConnections() {
    await Promise.all(registry.list().flatMap(async (record) => {
      if (record.url === focused.current?.url) return []
      const probe = await diagnose(record.url)
      setProbes((current) => ({ ...current, [record.url]: probe }))
      return [probe]
    }))
  }

  const value: ConnectionContextValue = {
    connections: records.map((record) => connection(record, focused.current, probes[record.url], ownUrl)),
    profileOrigin,
    addServer,
    removeServer: (url) => {
      const removed = registry.remove(url)
      if (!removed) return false
      if (focused.current?.url === url) {
        const removedAgent = focused.current
        focused.current = undefined
        removedAgent.unsubscribe()
        setTimeout(() => removedAgent.agent.dispose(), 10_000)
      }
      setProbes((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== url)))
      rerender((version) => version + 1)
      return true
    },
    resolveSlug: registry.resolveSlug,
    getServerBySlug: (slug) => {
      const resolution = registry.resolveSlug(slug)
      return resolution.kind === "registered"
        ? connection(resolution.connection, focused.current, probes[resolution.url], ownUrl)
        : undefined
    },
    getSlug: (server) => encodeServerSlug(server.url),
    diagnoseServer: diagnose,
    probeConnections,
    agent,
  }

  return <ConnectionContext value={value}>{children}</ConnectionContext>
}

export function useServers() {
  const context = use(ConnectionContext)
  if (!context) throw new Error("useServers must be used within ConnectionProvider")
  return context
}

export function useConnectionAgent(slug: string | undefined): ConnectionAgent | undefined {
  const context = useServers()
  const current = context.agent(slug)
  useSyncExternalStore(
    current ? current.subscribe : emptySubscribe,
    () => `${current?.status ?? "idle"}:${current?.lastSyncAt ?? 0}`,
    () => "idle:0",
  )
  return current
}

function connection(record: ConnectionRecord, focused: FocusedAgent | undefined, probe: ProbeResult | undefined, ownUrl?: string): Connection {
  const agentStatus = focused?.url === record.url ? focused.agent.status : undefined
  const health = agentStatus === "live"
    ? "live" as const
    : agentStatus === "connecting" || agentStatus === "reconnecting"
      ? agentStatus
      : agentStatus === "unauthorized"
        ? "auth-unsupported" as const
        : agentStatus === "upgrade-required"
          ? "upgrade-required" as const
          : agentStatus === "error"
            ? "error" as const
            : probe?.status === "reachable"
              ? record.url === ownUrl ? "self" as const : "reachable" as const
              : probe?.status === "auth-unsupported" || probe?.status === "upgrade-required" || probe?.status === "unreachable"
                ? probe.status
                : record.url === ownUrl ? "self" as const : "connecting" as const
  return {
    name: record.name,
    url: record.url,
    status: health === "live" || health === "reachable" || health === "self"
      ? "online"
      : health === "connecting" || health === "reconnecting" ? "connecting" : "offline",
    health,
    statusMessage: probe?.message,
    removable: !record.own,
  }
}

function emptySubscribe() {
  return () => {}
}
