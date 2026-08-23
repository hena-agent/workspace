import { Sync } from "@hena/schema/sync"
import { sValidator } from "@hono/standard-validator"
import { Schema } from "effect"
import { Hono } from "hono"
import type { CoreDomain } from "../core/domain"
import { validationHook } from "../http/error"

export function createFileSystemRoutes(domain: CoreDomain) {
  return new Hono()
    .get(
      "/fs/list",
      sValidator("query", Schema.toStandardSchemaV1(Sync.FileListQuery), validationHook),
      async (c) => {
        const input = c.req.valid("query")
        return c.json({ data: (await domain.listFiles(input)).slice(0, input.limit ?? 1_000) })
      },
    )
    .get("/fs/find", sValidator("query", Schema.toStandardSchemaV1(Sync.FileFindQuery), validationHook), async (c) =>
      c.json({ data: await domain.findFiles(c.req.valid("query")) }),
    )
}
