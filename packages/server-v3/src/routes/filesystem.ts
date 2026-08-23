import { Sync } from "@hena/schema/sync"
import { sValidator } from "@hono/standard-validator"
import { Schema } from "effect"
import { Hono } from "hono"
import type { CoreDomain } from "../core/domain"
import { validationHook } from "../http/error"

export function createFileSystemRoutes(domain: CoreDomain) {
  return new Hono()
    .get("/fs/list", sValidator("query", Schema.toStandardSchemaV1(Sync.FileListQuery), validationHook), async (c) =>
      c.json({ data: await domain.listFiles(c.req.valid("query")) }),
    )
    .get("/fs/find", sValidator("query", Schema.toStandardSchemaV1(Sync.FileFindQuery), validationHook), async (c) =>
      c.json({ data: await domain.findFiles(c.req.valid("query")) }),
    )
}
