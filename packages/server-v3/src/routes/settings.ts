import { Sync } from "@hena/schema/sync"
import { sValidator } from "@hono/standard-validator"
import { Schema } from "effect"
import { Hono } from "hono"
import { error, validationHook } from "../http/error"
import type { SyncDatabase } from "../storage/database"
import { IdempotencyConflict } from "../storage/idempotency"
import { RevisionConflict, SettingTooLarge } from "../storage/settings"

export function createSettingRoutes(database: SyncDatabase) {
  return new Hono().put(
    "/settings/:scope/:key",
    sValidator("json", Schema.toStandardSchemaV1(Sync.SettingReplace), validationHook),
    async (c) => {
      const body = c.req.valid("json")
      if (!validSetting(c.req.param("key"), body.value))
        return error(c, 400, "validation", "Setting key or value is not allowed")
      try {
        const result = await database.idempotency.run(
          { principal: "local", operation: "settings.replace", key: body.idempotencyKey, payload: body },
          () => {
            const txid = crypto.randomUUID()
            const replaced = database.settings.replace({
              scope: c.req.param("scope"),
              key: c.req.param("key"),
              value: body.value,
              expectedRevision: body.expectedRevision,
              txid,
            })
            return {
              value: body.value,
              revision: replaced.revision,
              receipt: {
                txid,
                outcome: "applied" as const,
                through: { feedId: database.feed.get().feedId, seq: replaced.change.seq },
                affectedScopes: [{ collection: "settings", scopeKey: c.req.param("scope") }],
              },
            }
          },
        )
        if (result.outcome === "exact_retry")
          return c.json({ ...result.response, receipt: { ...result.response.receipt, outcome: "exact_retry" as const } })
        return c.json(result.response)
      } catch (cause) {
        if (cause instanceof IdempotencyConflict) return error(c, 409, cause.code, "Idempotency key was reused with different input")
        if (cause instanceof RevisionConflict)
          return c.json({ error: { code: cause.code, message: cause.message, details: { authoritative: cause.authoritative } } }, 409)
        if (cause instanceof SettingTooLarge)
          return c.json({ error: { code: "payload_too_large", message: "Setting value exceeds 16 KiB" } }, 413)
        throw cause
      }
    },
  )
}

function validSetting(key: string, value: unknown) {
  if (key === "theme") return value === "system" || value === "light" || value === "dark"
  if (key === "notifications.sound" || key === "notifications.desktop") return typeof value === "boolean"
  if (key === "defaultAgent") return typeof value === "string" && value.length > 0 && value.length <= 256
  if (key === "queueDelivery") return value === "steer" || value === "queue"
  if (key !== "defaultModel" || typeof value !== "object" || value === null || Array.isArray(value)) return false
  const model = value as Record<string, unknown>
  return Object.keys(model).every((field) => ["id", "providerID", "variant"].includes(field)) &&
    typeof model.id === "string" && typeof model.providerID === "string" &&
    (model.variant === undefined || typeof model.variant === "string")
}
