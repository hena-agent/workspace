import { Database } from "@hena/core/database/database"
import path from "node:path"
import { createApp } from "./app"
import { createCoreDomain } from "./core/runtime"
import { createSyncDatabase } from "./storage/database"
import { createDeltaHub } from "./stream/delta"
import { bootstrapCollections, createLocationCollectionRefresh } from "./core/bootstrap"
import { createOnlineRequestStore } from "./core/online-requests"
import { Flag } from "@hena/core/flag/flag"

if (import.meta.main) await start()

export const Hostname = "127.0.0.1"

export async function start(input?: { port?: number; publicDir?: string; corsOrigins?: readonly string[] }) {
  assertNoPassword()
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
  if (bootstrapCollections(database)) database.feed.replace()
  const catalog = createLocationCollectionRefresh(database, domain, online, (cause) =>
    console.error(
      JSON.stringify({ type: "catalog_refresh_error", name: cause instanceof Error ? cause.name : "Unknown" }),
    ),
  )
  await catalog.run()
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
    corsOrigins: input?.corsOrigins,
    logger: (record) => console.error(JSON.stringify(record)),
    publicDir: input?.publicDir ?? path.resolve(import.meta.dir, "../../app-v3/dist"),
  })
  const server = Bun.serve({
    hostname: Hostname,
    port: input?.port ?? readPort(process.argv) ?? 4106,
    fetch: app.fetch,
  })
  const compaction = setInterval(() => database.compact(), 60 * 60_000)
  compaction.unref()
  const stop = async () => {
    clearInterval(compaction)
    unsubscribeCatalog()
    unsubscribeLocations()
    await catalog.idle()
    await domain.dispose()
    database.close()
    await server.stop()
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
