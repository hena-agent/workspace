import { useEffect, useState } from "react"
import type { ConnectionAgent } from "./agent"

export function RouteLoadingState({ agent, ready, missing }: { agent: ConnectionAgent | undefined; ready: boolean; missing: string }) {
  if (ready) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{missing}</div>
  const message = agent?.status === "unauthorized"
    ? "This server requires authentication, which this build does not support."
    : agent?.status === "upgrade-required"
      ? "This server uses an unsupported protocol version."
      : agent?.status === "error"
        ? "The server returned an invalid collection stream."
        : agent?.status === "reconnecting" ? "Reconnecting to the server..." : "Connecting to the server..."
  return <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">{message}</div>
}

export function ConnectionStateBanner({ agent }: { agent: ConnectionAgent | undefined }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (agent?.status !== "reconnecting") return
    const interval = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(interval)
  }, [agent?.status])
  if (agent?.status !== "reconnecting" || !agent.lastSyncAt || now - agent.lastSyncAt < 30_000) return null
  return (
    <div role="status" className="absolute top-2 left-1/2 z-50 -translate-x-1/2 rounded-md border bg-background px-3 py-1.5 text-xs shadow-sm">
      Reconnecting. Last synced {Math.floor((now - agent.lastSyncAt) / 1_000)} seconds ago.
    </div>
  )
}
