import { Sync } from "@hena/schema/sync"
import { PromptInput } from "@hena/schema/prompt-input"
import { Session } from "@hena/schema/session"
import { SessionMessage } from "@hena/schema/session-message"
import { sValidator } from "@hono/standard-validator"
import { Schema } from "effect"
import { Hono } from "hono"
import type { CoreDomain } from "../core/domain"
import { error, validationHook } from "../http/error"
import { preview } from "../storage/content"
import { fitsPage } from "../stream/pages"

const SessionParams = Schema.Struct({ sessionId: Session.ID })
const InputParams = Schema.Struct({ sessionId: Session.ID, inputId: SessionMessage.ID })

export function createSessionRoutes(domain: CoreDomain) {
  return new Hono()
    .post(
      "/session",
      sValidator("json", Schema.toStandardSchemaV1(Sync.CreateSession), validationHook),
      async (c) => {
        if (oversizedPrompt(c.req.valid("json").prompt))
          return error(c, 413, "payload_too_large", "Prompt exceeds the supported size")
        return c.json(await domain.createSession(c.req.valid("json")))
      },
    )
    .post(
      "/session/:sessionId/input/:inputId/cancel",
      sValidator("param", Schema.toStandardSchemaV1(InputParams), validationHook),
      sValidator("json", Schema.toStandardSchemaV1(Sync.CancelInput), validationHook),
      async (c) => c.json(await domain.cancelInput(
          c.req.valid("param").sessionId,
          c.req.valid("param").inputId,
          c.req.valid("json"),
        )),
    )
    .put(
      "/session/:sessionId/input-order",
      sValidator("param", Schema.toStandardSchemaV1(SessionParams), validationHook),
      sValidator("json", Schema.toStandardSchemaV1(Sync.ReorderInputs), validationHook),
      async (c) => c.json(await domain.reorderInputs(
          c.req.valid("param").sessionId,
          c.req.valid("json"),
        )),
    )
    .post(
      "/session/:sessionId/prompt",
      sValidator("param", Schema.toStandardSchemaV1(SessionParams), validationHook),
      sValidator("json", Schema.toStandardSchemaV1(Sync.AdmitPrompt), validationHook),
      async (c) => {
        if (oversizedPrompt(c.req.valid("json").prompt))
          return error(c, 413, "payload_too_large", "Prompt exceeds the supported size")
        return c.json(await domain.admitPrompt(c.req.valid("param").sessionId, c.req.valid("json")))
      },
    )
    .post(
      "/session/:sessionId/interrupt",
      sValidator("param", Schema.toStandardSchemaV1(SessionParams), validationHook),
      async (c) => {
        await domain.interrupt(c.req.valid("param").sessionId)
        return c.json({ outcome: "applied" as const })
      },
    )
}

function oversizedPrompt(prompt: PromptInput.Prompt) {
  const sizes = prompt.files?.map((file) => inlinedBytes(file.uri)) ?? []
  if (sizes.some((size) => size > 5 * 1024 * 1024) || sizes.reduce((total, size) => total + size, 0) > 20 * 1024 * 1024)
    return true
  const projected = {
    ...prompt,
    files: prompt.files?.map((file) => {
      const uri = preview(file.uri)
      if (!uri.truncated) return file
      return {
        ...file,
        uri: uri.text,
        truncated: true,
        content: { id: "x".repeat(64), revision: "x".repeat(64), bytes: uri.totalBytes },
      }
    }),
  }
  return !fitsPage([{
    key: "x".repeat(64),
    revision: "x".repeat(64),
    row: {
      id: "x".repeat(64),
      sessionID: "x".repeat(64),
      prompt: projected,
      delivery: "queue",
      admittedSeq: Number.MAX_SAFE_INTEGER,
      promotedSeq: Number.MAX_SAFE_INTEGER,
      queuePosition: Number.MAX_SAFE_INTEGER,
      queueRevision: Number.MAX_SAFE_INTEGER,
      timeCreated: Number.MAX_SAFE_INTEGER,
    },
  }])
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
