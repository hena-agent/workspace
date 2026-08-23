import type { Context } from "hono"
import { HTTPException } from "hono/http-exception"

export function error(
  c: Context,
  status: 400 | 404 | 409 | 413 | 429 | 500,
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return c.json({ error: { code, message, ...(details ? { details } : {}) } }, status)
}

export function validationHook(result: { success: boolean }, c: Context) {
  if (!result.success) return error(c, 400, "validation", "Request validation failed")
}

export function coreError(c: Context, cause: Error & { _tag?: string; code?: string; expected?: number; actual?: number }) {
  if (cause instanceof HTTPException && cause.status === 400)
    return error(c, 400, "validation", "Request validation failed")
  if (cause._tag === "Session.QueueRevisionConflictError")
    return error(c, 409, "revision_conflict", "Queue revision does not match", {
      expected: cause.expected,
      actual: cause.actual,
    })
  if (cause._tag === "Session.NotFoundError") return error(c, 404, "not_found", "Session not found")
  if (cause._tag === "Session.PromptConflictError") return error(c, 409, "conflict", "Prompt message ID conflicts")
  if (cause.code === "idempotency_conflict")
    return error(c, 409, "idempotency_conflict", "Idempotency key was reused with different input")
  if (cause.code === "stream_limit_exceeded")
    return error(c, 429, "stream_limit_exceeded", "Too many stream resources")
  console.error(JSON.stringify({ type: "request_error", name: cause.name, tag: cause._tag }))
  return error(c, 500, "internal", "Internal server error")
}
