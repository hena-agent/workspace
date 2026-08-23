import { Sync } from "@hena/schema/sync"
import { sValidator } from "@hono/standard-validator"
import { Schema } from "effect"
import { Hono } from "hono"
import type { CoreDomain } from "../core/domain"
import { validationHook } from "../http/error"

export function createOnlineRoutes(domain: CoreDomain) {
  return new Hono()
    .post(
      "/permission/:id/reply",
      sValidator("json", Schema.toStandardSchemaV1(Sync.PermissionReply), validationHook),
      async (c) => c.json(await domain.replyPermission(c.req.param("id"), c.req.valid("json"))),
    )
    .post(
      "/question/:id/reply",
      sValidator("json", Schema.toStandardSchemaV1(Sync.QuestionReply), validationHook),
      async (c) => c.json(await domain.replyQuestion(c.req.param("id"), c.req.valid("json"))),
    )
}
