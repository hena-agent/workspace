import { Effect } from "effect"
import type { ServerV3NetworkOptions } from "./network"
import { resolveServerV3NetworkOptions } from "./network"

export const startServerV3 = Effect.fn("Cli.startServerV3")(function* (args: ServerV3NetworkOptions) {
  const options = yield* resolveServerV3NetworkOptions(args)
  const { start } = yield* Effect.promise(() => import("@hena/server-v3"))
  const publicFiles = yield* Effect.promise(() =>
    // @ts-expect-error generated and embedded when compiling the release binary
    import("hena-web-ui.gen.ts").then(parseEmbeddedFiles).catch(() => undefined),
  )
  return yield* Effect.promise(() =>
    start({ port: options.port, corsOrigins: options.cors, publicFiles, signals: false }),
  )
})

export function waitForServerV3(server: { stop: () => Promise<void> }) {
  return Effect.callback<void>((resume) => {
    const stop = () => {
      void server.stop().then(
        () => resume(Effect.void),
        (cause) => resume(Effect.die(cause)),
      )
    }
    process.once("SIGINT", stop)
    process.once("SIGTERM", stop)
    return Effect.sync(() => {
      process.off("SIGINT", stop)
      process.off("SIGTERM", stop)
    })
  })
}

function parseEmbeddedFiles(module: unknown) {
  if (!module || typeof module !== "object" || !("default" in module)) return undefined
  const files = module.default
  if (!files || typeof files !== "object" || Array.isArray(files)) return undefined
  const entries = Object.entries(files)
  if (!entries.every((entry): entry is [string, string] => typeof entry[1] === "string")) return undefined
  return Object.fromEntries(entries)
}
