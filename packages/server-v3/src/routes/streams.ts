import { Sync } from "@hena/schema/sync"
import { sValidator } from "@hono/standard-validator"
import { Schema } from "effect"
import { Hono } from "hono"
import { error, validationHook } from "../http/error"
import type { SyncDatabase } from "../storage/database"
import { StreamRevisionConflict, createStreamRegistry } from "../stream/registry"
import { events } from "../stream/events"
import type { DeltaHub } from "../stream/delta"
import type { OnlineRequestStore } from "../core/online-requests"

export type StreamRegistry = ReturnType<typeof createStreamRegistry>

export function createStreamRoutes(database: SyncDatabase, streams: StreamRegistry, deltas: DeltaHub, online: OnlineRequestStore) {
  return new Hono()
    .post("/streams", (c) => {
      const stream = streams.create("local")
      const feed = database.feed.get()
      c.header("Cache-Control", "no-store")
      return c.json(
        {
          streamId: stream.id,
          generation: stream.generation,
          expiresAt: stream.expiresAt,
          feed: {
            feedId: feed.feedId,
            runtimeId: feed.runtimeId,
            retainedFloor: feed.retainedFloor,
          },
          subscriptionRevision: 0,
        },
        201,
      )
    })
    .put(
      "/streams/:streamId/subscription",
      sValidator("json", Schema.toStandardSchemaV1(Sync.Subscription), validationHook),
      (c) => {
        const stream = streams.get("local", c.req.param("streamId"))
        if (!stream) return error(c, 404, "not_found", "Stream not found")
        try {
          const subscription = streams.subscribe("local", stream.id, c.req.valid("json"))
          return c.json({ revision: subscription!.revision, generation: stream.generation })
        } catch (cause) {
          if (cause instanceof StreamRevisionConflict)
            return error(c, 409, cause.code, "Subscription revisions must increase")
          throw cause
        }
      },
    )
    .get("/streams/:streamId/events", (c) => events(c, database, streams, deltas, online))
    .delete("/streams/:streamId", (c) => {
      if (!streams.delete("local", c.req.param("streamId"))) return error(c, 404, "not_found", "Stream not found")
      return c.body(null, 204)
    })
}
