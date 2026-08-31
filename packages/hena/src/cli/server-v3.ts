import { Effect } from "effect"
import { isRecord } from "@/util/record"
import { embeddedUI } from "@/server/shared/embedded-ui"
import { CliError } from "./effect-cmd"
import type { ServerV3NetworkOptions } from "./network"
import { resolveServerV3NetworkOptions } from "./network"

export const startServerV3 = Effect.fn("Cli.startServerV3")(function* (args: ServerV3NetworkOptions) {
  const options = yield* resolveServerV3NetworkOptions(args)
  if (options.hostname !== "127.0.0.1" || options.mdns)
    return yield* new CliError({
      message: "server-v3 only supports --hostname 127.0.0.1 without mDNS until authentication is available.",
    })
  const { start } = yield* Effect.promise(() => import("@hena/server-v3/start"))
  const files = yield* Effect.promise(() => embeddedUI(false))
  return yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () =>
        start({
          port: options.port,
          corsOrigins: options.cors,
          staticSource: files ? { type: "embedded", files } : undefined,
        }),
      catch: (cause) => new CliError({ message: startupError(cause, options.port) }),
    }),
    (running) => Effect.promise(() => running.stop()),
  )
})

export function waitForServerV3() {
  return Effect.callback<void>((resume) => {
    const done = () => resume(Effect.void)
    process.once("SIGINT", done)
    process.once("SIGTERM", done)
    return Effect.sync(() => {
      process.off("SIGINT", done)
      process.off("SIGTERM", done)
    })
  })
}

function startupError(cause: unknown, port: number) {
  if (isRecord(cause) && cause.code === "EADDRINUSE")
    return `Port ${port} is already in use. Choose another port with --port.`
  if (cause instanceof Error && cause.message.includes("password authentication"))
    return "HENA_SERVER_PASSWORD is not supported by server-v3 yet. Unset it before starting Hena."
  return `Failed to start Hena server: ${cause instanceof Error ? cause.message : String(cause)}`
}
