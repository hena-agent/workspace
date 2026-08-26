import { Sync } from "@hena/schema/sync"
import { sValidator } from "@hono/standard-validator"
import { Schema } from "effect"
import { Hono } from "hono"
import { catalogView } from "../core/catalog-view"
import type { CoreDomain } from "../core/domain"
import { validationHook } from "../http/error"

// Unlike the `agents`/`models`/`providers` collection scopes (which only exist once a
// directory is a known location, see collection-projector's `reconcileLocations`), the New
// Session composer needs a catalog before any session (and therefore location) exists yet.
// `domain.catalog` already computes this without requiring a durable location, so expose it
// directly instead of waiting on the collection sync pipeline.
export function createCatalogRoutes(domain: CoreDomain) {
  return new Hono().get(
    "/catalog",
    sValidator("query", Schema.toStandardSchemaV1(Sync.CatalogQuery), validationHook),
    async (c) => c.json(catalogView(await domain.catalog(c.req.valid("query")))),
  )
}
