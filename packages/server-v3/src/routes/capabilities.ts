import { Hono } from "hono"
import type { SyncDatabase } from "../storage/database"

export function createCapabilitiesRoutes(database: SyncDatabase) {
  return new Hono().get("/capabilities", (c) => {
    c.header("Cache-Control", "no-store")
    return c.json({
      feedId: database.feed.get().feedId,
      protocol: { min: 1 as const, max: 1 as const },
      auth: "none" as const,
    })
  })
}
