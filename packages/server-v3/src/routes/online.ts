import { Sync } from "@hena/schema/sync"
import { Permission } from "@hena/schema/permission"
import { Question } from "@hena/schema/question"
import { sValidator } from "@hono/standard-validator"
import { Schema } from "effect"
import { Hono } from "hono"
import type { CoreDomain } from "../core/domain"
import { validationHook } from "../http/error"

const PermissionParams = Schema.Struct({ id: Permission.ID })
const QuestionParams = Schema.Struct({ id: Question.ID })

export function createOnlineRoutes(domain: CoreDomain) {
  return new Hono()
    .post(
      "/permission/:id/reply",
      sValidator("param", Schema.toStandardSchemaV1(PermissionParams), validationHook),
      sValidator("json", Schema.toStandardSchemaV1(Sync.PermissionReply), validationHook),
      async (c) => c.json(await domain.replyPermission(c.req.valid("param").id, c.req.valid("json"))),
    )
    .post(
      "/question/:id/reply",
      sValidator("param", Schema.toStandardSchemaV1(QuestionParams), validationHook),
      sValidator("json", Schema.toStandardSchemaV1(Sync.QuestionReply), validationHook),
      async (c) => c.json(await domain.replyQuestion(c.req.valid("param").id, c.req.valid("json"))),
    )
}
