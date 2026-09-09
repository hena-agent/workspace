import type { Agent } from "./types"

export function resolveAgent(agents: Agent[], ...ids: (string | undefined)[]) {
  return ids.map((id) => agents.find((agent) => agent.id === id)).find((agent) => agent !== undefined)
    ?? agents.find((agent) => agent.id === "build")
    ?? agents[0]
}
