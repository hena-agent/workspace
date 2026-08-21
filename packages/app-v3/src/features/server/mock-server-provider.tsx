import { createContext, use, useState, type ReactNode } from "react"
import type { Connection } from "@/lib/types"
import { encodeServerSlug, normalizeServerUrl } from "@/lib/server-url"
import { connections as initialConnections } from "@/mock/fixtures"

const MockServerContext = createContext<
  | {
      connections: Connection[]
      addServer: (url: string) => Connection | undefined
      getServerBySlug: (slug: string | undefined) => Connection | undefined
      getSlug: (connection: Connection) => string
    }
  | undefined
>(undefined)

export function MockServerProvider({ children }: { children: ReactNode }) {
  const [connections, setConnections] = useState(() => initialConnections.map((connection) => ({ ...connection })))

  function addServer(input: string) {
    const url = normalizeServerUrl(input)
    if (!url) return

    const existing = connections.find((connection) => connection.url === url)
    if (existing) return existing

    const connection: Connection = {
      id: `conn-${encodeServerSlug(url)}`,
      name: new URL(url).host,
      url,
      status: "online",
    }
    setConnections((current) => [...current, connection])
    return connection
  }

  function getServerBySlug(slug: string | undefined) {
    if (!slug) return
    return connections.find((connection) => encodeServerSlug(connection.url) === slug)
  }

  return (
    <MockServerContext
      value={{
        connections,
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
