import { Database } from "@hena/core/database/database"
import path from "node:path"
import { createApp } from "./app"
import { createCoreDomain } from "./core/runtime"
import { createSyncDatabase } from "./storage/database"
import { createDeltaHub } from "./stream/delta"
import { bootstrapCollections, createLocationCollectionRefresh } from "./core/bootstrap"
import { createOnlineRequestStore } from "./core/online-requests"
import { Flag } from "@hena/core/flag/flag"
import { Global } from "@hena/core/global"
import { ConfigV1 } from "@hena/core/v1/config/config"
import { Option, Schema } from "effect"
import type { StaticSource } from "./http/static"

export const Hostname = "127.0.0.1"

if (import.meta.main) {
  const running = await start()
  const stop = () => void running.stop()
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  console.error(`server-v3 listening on ${running.server.url}`)
}

export async function start(input?: {
  port?: number
  staticSource?: StaticSource
  corsOrigins?: readonly string[]
}) {
  assertNoPassword()
  const corsOrigins = [...(await configuredCorsOrigins()), ...viteCorsOrigins(), ...(input?.corsOrigins ?? [])]
  const server = Bun.serve({
    hostname: Hostname,
    port: input?.port ?? readPort(process.argv) ?? 4106,
    fetch: () => new Response("Server is starting", { status: 503 }),
    idleTimeout: 0,
  })
  const cleanups: Array<() => void | Promise<void>> = []
  const dispose = () =>
    cleanups.reduceRight(
      (result, cleanup) =>
        result
          .then(cleanup)
          .catch((cause) =>
            console.error(
              JSON.stringify({ type: "server_cleanup_error", name: cause instanceof Error ? cause.name : "Unknown" }),
            ),
          ),
      Promise.resolve(),
    )
  try {
    const deltas = createDeltaHub()
    const online = createOnlineRequestStore()
    const persisted = { publish: () => {} }
    const configuredDatabasePath = Database.path()
    const databasePath =
      configuredDatabasePath === ":memory:"
        ? `file:hena-server-v3-${crypto.randomUUID()}?mode=memory&cache=shared`
        : configuredDatabasePath
    const domain = createCoreDomain(deltas, online, () => persisted.publish(), databasePath)
    cleanups.push(() => domain.dispose())
    await domain.ready()
    const sqlite = await import("bun:sqlite")
    const raw = new sqlite.Database(databasePath, { create: true })
    cleanups.unshift(() => raw.close())
    const database = createSyncDatabase(raw)
    cleanups[0] = () => database.close()
    persisted.publish = database.changes.publishPersisted
    database.compact()
    database.raw.transaction(() => {
      if (bootstrapCollections(database)) database.feed.replace()
    })()
    const catalog = createLocationCollectionRefresh(database, domain, online, (cause) =>
      console.error(
        JSON.stringify({ type: "catalog_refresh_error", name: cause instanceof Error ? cause.name : "Unknown" }),
      ),
    )
    cleanups.push(() => catalog.idle())
    void catalog.run()
    await catalog.idle()
    const unsubscribeCatalog = online.subscribeCatalog(() => {
      void catalog.run()
    })
    cleanups.push(() => {
      unsubscribeCatalog()
    })
    const unsubscribeLocations = database.changes.subscribe("locations", "", () => {
      void catalog.run()
    })
    cleanups.push(() => {
      unsubscribeLocations()
    })
    server.reload({
      fetch: createApp({
        database,
        domain,
        deltas,
        online,
        corsOrigins,
        logger: (record) => console.error(JSON.stringify(record)),
        staticSource: input?.staticSource ?? {
          type: "disk",
          directory: path.resolve(import.meta.dir, "../../app-v3/dist"),
        },
      }).fetch,
    })
    const compaction = setInterval(() => database.compact(), 60 * 60_000)
    compaction.unref()
    cleanups.push(() => clearInterval(compaction))
    let shutdown: Promise<void> | undefined
    const stop = () => {
      if (shutdown) return shutdown
      shutdown = (async () => {
        await server.stop(true)
        await dispose()
      })()
      return shutdown
    }
    return { server, stop }
  } catch (cause) {
    await server.stop(true)
    await dispose()
    throw cause
  }
}

export function assertNoPassword(password = Flag.HENA_SERVER_PASSWORD) {
  if (password) throw new Error("server-v3 password authentication is not available until phase 2")
}

export function readPort(argv: readonly string[]) {
  const index = argv.indexOf("--port")
  if (index === -1) return undefined
  const port = Number(argv[index + 1])
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("--port must be an integer from 1 to 65535")
  return port
}

async function configuredCorsOrigins() {
  const directory = Flag.HENA_CONFIG_DIR ?? Global.Path.config
  const configs = await Promise.all(
    ["hena.json", "hena.jsonc"].map(async (name) => {
      const file = Bun.file(path.join(directory, name))
      if (!(await file.exists())) return undefined
      const parsed = await file
        .text()
        .then((text) => Bun.JSONC.parse(text))
        .catch((cause: unknown) => {
          console.error(
            JSON.stringify({ type: "server_config_error", name: cause instanceof Error ? cause.name : "Unknown" }),
          )
          return undefined
        })
      return Option.getOrUndefined(
        Schema.decodeUnknownOption(ConfigV1.Info, { errors: "all", onExcessProperty: "ignore" })(parsed),
      )
    }),
  )
  return configs.findLast((config) => config?.server?.cors !== undefined)?.server?.cors ?? []
}

function viteCorsOrigins(hosts = process.env.HENA_VITE_ALLOWED_HOSTS) {
  return (hosts ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter((host) => /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host))
    .map((host) => `http://${host}:5173`)
}
