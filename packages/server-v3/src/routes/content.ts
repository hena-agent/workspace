import { Hono } from "hono"
import { Sync } from "@hena/schema/sync"
import { sValidator } from "@hono/standard-validator"
import { Schema } from "effect"
import { error } from "../http/error"
import { validationHook } from "../http/error"
import { InvalidContentOffset } from "../storage/content"
import type { SyncDatabase } from "../storage/database"

const MaximumPageBytes = 256 * 1024

export function createContentRoutes(database: SyncDatabase) {
  return new Hono().get(
    "/content/:contentId",
    sValidator("query", Schema.toStandardSchemaV1(Sync.ContentQuery), validationHook),
    (c) => {
      const input = c.req.valid("query")
      const offset = input.offset ?? 0
      const limit = input.limit ?? MaximumPageBytes
      try {
        const page = database.content.page({ id: c.req.param().contentId, sessionID: input.sessionID, revision: input.revision, offset, limit })
        if (!page) return error(c, 404, "not_found", "Content not found")
        return c.json(page)
      } catch (cause) {
        if (cause instanceof InvalidContentOffset) return error(c, 400, "validation", "Offset must be a UTF-8 code point boundary")
        throw cause
      }
    },
  )
}
