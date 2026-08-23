import { Hono } from "hono"
import type { SyncDatabase } from "../storage/database"
import { createStreamRegistry } from "../stream/registry"
import { createCapabilitiesRoutes } from "./capabilities"
import { createStreamRoutes } from "./streams"
import type { DeltaHub } from "../stream/delta"
import type { OnlineRequestStore } from "../core/online-requests"

export function createCollectionRoutes(database: SyncDatabase, deltas: DeltaHub, online: OnlineRequestStore) {
  const streams = createStreamRegistry({ graceMs: 5 * 60_000 })
  return new Hono()
    .route("/", createCapabilitiesRoutes(database))
    .route("/", createStreamRoutes(database, streams, deltas, online))
}
