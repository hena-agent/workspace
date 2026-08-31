import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { withServerV3NetworkOptions } from "../network"
import { startServerV3, waitForServerV3 } from "../server-v3"

export const ServeCommand = effectCmd({
  command: ["serve", "$0"],
  builder: (yargs) => withServerV3NetworkOptions(yargs),
  describe: "start Hena server and web interface",
  instance: false,
  handler: Effect.fn("Cli.serve")(function* (args) {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const running = yield* startServerV3(args)
        console.log(`hena server listening on http://${running.server.hostname}:${running.server.port}`)
        yield* waitForServerV3()
      }),
    )
  }),
})
