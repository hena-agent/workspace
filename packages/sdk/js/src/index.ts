export * from "./client.js"
export * from "./server.js"

import { createHenaAgentClient } from "./client.js"
import { createHenaAgentServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createHenaAgent(options?: ServerOptions) {
  const server = await createHenaAgentServer({
    ...options,
  })

  const client = createHenaAgentClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
