import { createContext, use, useState, type ReactNode } from "react"
import type { Connection } from "@/lib/types"
import { decodeServerSlug, encodeServerSlug, isServerUrlAllowed, normalizeServerUrl } from "@/lib/server-url"
import { connections } from "@/mock/fixtures"

const MockServerContext = createContext<
  | {
      connections: Connection[]
      addServer: (url: string) => Connection | undefined
      getServerBySlug: (slug: string | undefined) => Connection | undefined
      getSlug: (connection: Connection) => string
    }
  | undefined
>(undefined)

export function MockServerProvider({
  children,
  initialConnections = connections,
  pageOrigin = window.location.origin,
}: {
  children: ReactNode
  initialConnections?: Connection[]
  pageOrigin?: string
}) {
  const [servers, setServers] = useState(() =>
    initialConnections.flatMap((connection) =>
      isServerUrlAllowed(connection.url, pageOrigin) ? [{ ...connection }] : [],
    ),
  )

  function addServer(input: string) {
    const url = normalizeServerUrl(input)
    if (!url || !isServerUrlAllowed(url, pageOrigin)) return

    const existing = servers.find((connection) => connection.url === url)
    if (existing) return existing

    const known = connections.find((connection) => connection.url === url)
    const connection: Connection = known
      ? { ...known }
      : {
          id: `conn-${encodeServerSlug(url)}`,
          name: new URL(url).host,
          url,
          status: "online",
        }
    setServers((current) => [...current, connection])
    return connection
  }

  function getServerBySlug(slug: string | undefined) {
    if (!slug) return
    const url = decodeServerSlug(slug)
    if (!url) return
    return servers.find((connection) => connection.url === url)
  }

  return (
    <MockServerContext
      value={{
        connections: servers,
        addServer,
        getServerBySlug,
        getSlug: (connection) => encodeServerSlug(connection.url),
      }}
    >
      {children}
    </MockServerContext>
  )
}

export function useMockServers() {
  const context = use(MockServerContext)
  if (!context) throw new Error("useMockServers must be used within MockServerProvider")
  return context
}
