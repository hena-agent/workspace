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

if (import.meta.main) await start()

export const Hostname = "127.0.0.1"

export async function start(input?: { port?: number; publicDir?: string; corsOrigins?: readonly string[] }) {
  assertNoPassword()
  const corsOrigins = [...(await configuredCorsOrigins()), ...viteCorsOrigins(), ...(input?.corsOrigins ?? [])]
  const deltas = createDeltaHub()
  const online = createOnlineRequestStore()
  const persisted = { publish: () => {} }
  const configuredDatabasePath = Database.path()
  const databasePath =
    configuredDatabasePath === ":memory:"
      ? `file:hena-server-v3-${crypto.randomUUID()}?mode=memory&cache=shared`
      : configuredDatabasePath
  const domain = createCoreDomain(deltas, online, () => persisted.publish(), databasePath)
  await domain.ready()
  const sqlite = await import("bun:sqlite")
  const database = createSyncDatabase(new sqlite.Database(databasePath, { create: true }))
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
  void catalog.run()
  await catalog.idle()
  const unsubscribeCatalog = online.subscribeCatalog(() => {
    void catalog.run()
  })
  const unsubscribeLocations = database.changes.subscribe("locations", "", () => {
    void catalog.run()
  })
  const app = createApp({
    database,
    domain,
    deltas,
    online,
    corsOrigins,
    logger: (record) => console.error(JSON.stringify(record)),
    publicDir: input?.publicDir ?? path.resolve(import.meta.dir, "../../app-v3/dist"),
  })
  const server = Bun.serve({
    hostname: Hostname,
    port: input?.port ?? readPort(process.argv) ?? 4106,
    fetch: app.fetch,
    idleTimeout: 0,
  })
  const compaction = setInterval(() => database.compact(), 60 * 60_000)
  compaction.unref()
  let shutdown: Promise<void> | undefined
  const stop = () => {
    if (shutdown) return shutdown
    shutdown = (async () => {
      process.off("SIGINT", stop)
      process.off("SIGTERM", stop)
      clearInterval(compaction)
      await server.stop(true)
      unsubscribeCatalog()
      unsubscribeLocations()
      await catalog.idle()
      await domain.dispose()
      database.close()
    })()
    return shutdown
  }
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  console.error(`server-v3 listening on ${server.url}`)
  return { server, stop }
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
