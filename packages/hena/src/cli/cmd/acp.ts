import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import { Readable, Writable } from "node:stream"
import { ServerAuth } from "@/server/auth"
import { createHenaClient } from "@hena/sdk/v2"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { ACPProfile } from "@/acp/profile"

export const AcpCommand = effectCmd({
  command: "acp",
  describe: "start ACP (Agent Client Protocol) server",
  builder: (yargs) => {
    return withNetworkOptions(yargs).option("cwd", {
      describe: "working directory",
      type: "string",
      default: process.cwd(),
    })
  },
  handler: Effect.fn("Cli.acp")(function* (args) {
    const { Server } = yield* Effect.promise(() => import("@/server/server"))
    const { ACP } = yield* Effect.promise(() => import("@/acp/agent"))
    ACPProfile.mark("cli.acp.handler")
    process.env.HENA_CLIENT = "acp"
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => ACPProfile.measure("cli.acp.server.listen", () => Server.listen(opts)))

    const sdk = createHenaClient({
      baseUrl: `http://${server.hostname}:${server.port}`,
      headers: ServerAuth.headers(),
    })

    const stream = ndJsonStream(
      Writable.toWeb(process.stdout),
      Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>,
    )
    const agent = ACP.init({ sdk })

    const connection = new AgentSideConnection((conn) => {
      ACPProfile.mark("cli.acp.connection.create")
      return agent.create(conn)
    }, stream)

    yield* Effect.logInfo("setup connection")
    yield* Effect.promise(() => connection.closed)
  }),
})
