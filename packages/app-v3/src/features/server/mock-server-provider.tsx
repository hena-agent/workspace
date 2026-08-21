import { createContext, use, useState, type ReactNode } from "react"
import type { Connection } from "@/lib/types"
import { decodeServerSlug, encodeServerSlug, isServerUrlAllowed, normalizeServerUrl } from "@/lib/server-url"
import { connections } from "@/mock/fixtures"

const MockServerContext = createContext<
  | {
      connections: Connection[]
      profileOrigin: string
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
  embeddedOrigin,
}: {
  children: ReactNode
  initialConnections?: Connection[]
  pageOrigin?: string
  embeddedOrigin?: string
}) {
  const profileOrigin = new URL(pageOrigin).origin
  const [servers, setServers] = useState(() => {
    const seeded = initialConnections.flatMap((connection) =>
      isServerUrlAllowed(connection.url, pageOrigin) ? [{ ...connection }] : [],
    )
    const ownUrl = embeddedOrigin ? normalizeServerUrl(embeddedOrigin) : undefined
    if (!ownUrl || ownUrl !== profileOrigin || !isServerUrlAllowed(ownUrl, pageOrigin)) return seeded

    const ownServer =
      seeded.find((connection) => connection.url === ownUrl) ?? createMockConnection(ownUrl)
    return [ownServer, ...seeded.filter((connection) => connection.id !== ownServer.id)]
  })

  function addServer(input: string) {
    const url = normalizeServerUrl(input)
    if (!url || !isServerUrlAllowed(url, pageOrigin)) return

    const existing = servers.find((connection) => connection.url === url)
    if (existing) return existing

    const connection = createMockConnection(url)
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
        profileOrigin,
        addServer,
        getServerBySlug,
        getSlug: (connection) => encodeServerSlug(connection.url),
      }}
    >
      {children}
    </MockServerContext>
  )
}

function createMockConnection(url: string): Connection {
  const known = connections.find((connection) => connection.url === url)
  if (known) return { ...known }
  return {
    id: `conn-${encodeServerSlug(url)}`,
    name: new URL(url).host,
    url,
    status: "online",
  }
}

export function useMockServers() {
  const context = use(MockServerContext)
  if (!context) throw new Error("useMockServers must be used within MockServerProvider")
  return context
}
