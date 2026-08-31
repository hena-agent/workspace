import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd } from "../effect-cmd"
import { withServerV3NetworkOptions } from "../network"
import { startServerV3, waitForServerV3 } from "../server-v3"
import open from "open"

export const WebCommand = effectCmd({
  command: "web",
  builder: (yargs) => withServerV3NetworkOptions(yargs),
  describe: "start Hena server and open web interface",
  instance: false,
  handler: Effect.fn("Cli.web")(function* (args) {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const running = yield* startServerV3(args)
        UI.empty()
        UI.println(UI.logo("  "))
        UI.empty()
        const displayUrl = running.server.url.toString()
        UI.println(UI.Style.TEXT_INFO_BOLD + "  Web interface:    ", UI.Style.TEXT_NORMAL, displayUrl)
        open(displayUrl).catch(() => {})
        yield* waitForServerV3()
      }),
    )
  }),
})
