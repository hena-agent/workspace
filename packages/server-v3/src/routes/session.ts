import { Sync } from "@hena/schema/sync"
import { sValidator } from "@hono/standard-validator"
import { Schema } from "effect"
import { Hono } from "hono"
import type { CoreDomain } from "../core/domain"
import { error, validationHook } from "../http/error"

export function createSessionRoutes(domain: CoreDomain) {
  return new Hono()
    .post(
      "/session",
      sValidator("json", Schema.toStandardSchemaV1(Sync.CreateSession), validationHook),
      async (c) => {
        if (oversizedAttachment(c.req.valid("json").prompt))
          return error(c, 413, "payload_too_large", "Attachment exceeds 5 MiB")
        return c.json(await domain.createSession(c.req.valid("json")))
      },
    )
    .post(
      "/session/:sessionId/input/:inputId/cancel",
      sValidator("json", Schema.toStandardSchemaV1(Sync.CancelInput), validationHook),
      async (c) => c.json(await domain.cancelInput(
          c.req.param("sessionId"),
          c.req.param("inputId"),
          c.req.valid("json"),
        )),
    )
    .put(
      "/session/:sessionId/input-order",
      sValidator("json", Schema.toStandardSchemaV1(Sync.ReorderInputs), validationHook),
      async (c) => c.json(await domain.reorderInputs(
          c.req.param("sessionId"),
          c.req.valid("json"),
        )),
    )
    .post(
      "/session/:sessionId/prompt",
      sValidator("json", Schema.toStandardSchemaV1(Sync.AdmitPrompt), validationHook),
      async (c) => {
        if (oversizedAttachment(c.req.valid("json").prompt))
          return error(c, 413, "payload_too_large", "Attachment exceeds 5 MiB")
        return c.json(await domain.admitPrompt(c.req.param("sessionId"), c.req.valid("json")))
      },
    )
    .post("/session/:sessionId/interrupt", async (c) => {
      await domain.interrupt(c.req.param("sessionId"))
      return c.json({ outcome: "applied" as const })
    })
}

function oversizedAttachment(prompt: { files?: readonly { uri: string }[] }) {
  const sizes = prompt.files?.map((file) => inlinedBytes(file.uri)) ?? []
  return sizes.some((size) => size > 5 * 1024 * 1024) || sizes.reduce((total, size) => total + size, 0) > 20 * 1024 * 1024
}

function inlinedBytes(uri: string) {
  if (!uri.startsWith("data:")) return 0
  const separator = uri.indexOf(",")
  if (separator === -1) return 0
  const data = uri.slice(separator + 1)
  if (!uri.slice(0, separator).endsWith(";base64")) return new TextEncoder().encode(data).byteLength
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0
  return Math.floor(data.length * 3 / 4) - padding
}
