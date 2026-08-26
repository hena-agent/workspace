import { Hono } from "hono"
import { error } from "../http/error"
import { InvalidContentOffset } from "../storage/content"
import type { SyncDatabase } from "../storage/database"

const MaximumPageBytes = 256 * 1024

export function createContentRoutes(database: SyncDatabase) {
  return new Hono().get("/content/:contentId", (c) => {
    const sessionID = c.req.query("sessionID")
    const revision = c.req.query("revision")
    const offset = integer(c.req.query("offset") ?? "0")
    const limit = integer(c.req.query("limit") ?? String(MaximumPageBytes))
    if (!sessionID || !revision || offset === undefined || limit === undefined || limit < 1 || limit > MaximumPageBytes)
      return error(c, 400, "validation", "Invalid content page request")
    try {
      const page = database.content.page({ id: c.req.param("contentId"), sessionID, revision, offset, limit })
      if (!page) return error(c, 404, "not_found", "Content not found")
      return c.json(page)
    } catch (cause) {
      if (cause instanceof InvalidContentOffset) return error(c, 400, "validation", "Offset must be a UTF-8 code point boundary")
      throw cause
    }
  })
}

function integer(input: string) {
  if (!/^\d+$/.test(input)) return undefined
  const value = Number(input)
  return Number.isSafeInteger(value) ? value : undefined
}
