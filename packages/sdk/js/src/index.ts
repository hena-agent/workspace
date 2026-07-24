export * from "./client.js"
export * from "./server.js"

import { createHenaClient } from "./client.js"
import { createHenaServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createHena(options?: ServerOptions) {
  const server = await createHenaServer({
    ...options,
  })

  const client = createHenaClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
