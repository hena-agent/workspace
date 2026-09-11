import { parseArgs } from "node:util"
import { Server } from "../src/server/server"

// Development backend for packages/app. The public serve/web CLI uses V3.
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { port: { type: "string", default: "4096" } },
  allowPositionals: false,
})
const port = Number(values.port)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("--port must be an integer from 1 to 65535")
}

const server = await Server.listen({ port, hostname: "127.0.0.1" })
const stop = async () => {
  await server.stop()
  process.exit(0)
}
process.once("SIGINT", stop)
process.once("SIGTERM", stop)
console.log(`hena legacy dev server listening on ${server.url}`)
