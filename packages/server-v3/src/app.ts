import { Hono } from "hono"
import type { ApplyGlobalResponse } from "hono/client"
import { compress } from "hono/compress"
import { bodyLimit } from "hono/body-limit"
import type { SyncDatabase } from "./storage/database"
import { createCollectionRoutes } from "./routes/collection"
import { createSettingRoutes } from "./routes/settings"
import { unavailableCoreDomain, type CoreDomain } from "./core/domain"
import { createSessionRoutes } from "./routes/session"
import { exactOriginCors } from "./http/cors"
import { createStaticRoutes } from "./http/static"
import { createFileSystemRoutes } from "./routes/filesystem"
import { createCatalogRoutes } from "./routes/catalog"
import { createContentRoutes } from "./routes/content"
import { createDeltaHub, type DeltaHub } from "./stream/delta"
import { createOnlineRequestStore, type OnlineRequestStore } from "./core/online-requests"
import { createOnlineRoutes } from "./routes/online"
import { coreError, error, type ErrorCode } from "./http/error"

export function createApp(input: {
  database: SyncDatabase
  domain?: CoreDomain
  publicDir?: string
  corsOrigins?: readonly string[]
  deltas?: DeltaHub
  online?: OnlineRequestStore
  logger?: (record: { method: string; path: string; status: number; durationMs: number; correlationId: string }) => void
}) {
  const app = new Hono()
  app.onError((cause, context) => coreError(context, cause))
  app.notFound((context) =>
    context.req.path.startsWith("/api")
      ? error(context, 404, "not_found", "API route not found")
      : context.text("404 Not Found", 404),
  )
  app.use(
    "/api/*",
    exactOriginCors(
      Array.from(
        new Set([
          "https://app.hena.dev",
          "http://localhost:5173",
          "http://127.0.0.1:5173",
          ...(input.corsOrigins ?? []),
        ]),
      ),
    ),
  )
  app.use("/api/*", (context, next) =>
    bodyLimit({
      maxSize: requestLimit(context.req.path),
      onError: (current) =>
        current.json({ error: { code: "payload_too_large", message: "Request body is too large" } }, 413),
    })(context, next),
  )
  if (input.logger)
    app.use("*", async (context, next) => {
      const started = performance.now()
      const correlationId = context.req.header("x-correlation-id") ?? crypto.randomUUID()
      context.header("X-Correlation-ID", correlationId)
      await next()
      input.logger!({
        method: context.req.method,
        path: context.req.path,
        status: context.res.status,
        durationMs: Math.round(performance.now() - started),
        correlationId,
      })
    })
  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store")
    await next()
  })
  app.use("*", async (context, next) => {
    if (context.req.path.endsWith("/events")) return next()
    return compress()(context, next)
  })
  const domain = input.domain ?? unavailableCoreDomain()
  const deltas = input.deltas ?? createDeltaHub()
  const online = input.online ?? createOnlineRequestStore()
  const api = app
    .route("/api/collection", createCollectionRoutes(input.database, deltas, online))
    .route("/api", createSettingRoutes(input.database))
    .route("/api", createSessionRoutes(domain))
    .route("/api", createFileSystemRoutes(domain))
    .route("/api", createCatalogRoutes(domain))
    .route("/api", createContentRoutes(input.database))
    .route("/api", createOnlineRoutes(domain))
  if (!input.publicDir) return api
  return api.route("/", createStaticRoutes(input.publicDir))
}

type ErrorResponse = { error: { code: ErrorCode; message: string; details?: Record<string, unknown> } }

export type AppType = ApplyGlobalResponse<
  ReturnType<typeof createApp>,
  {
    400: { json: ErrorResponse }
    401: { json: ErrorResponse }
    404: { json: ErrorResponse }
    409: { json: ErrorResponse }
    413: { json: ErrorResponse }
    429: { json: ErrorResponse }
    500: { json: ErrorResponse }
  }
>

function requestLimit(path: string) {
  if (path === "/api/session" || /\/api\/session\/[^/]+\/prompt$/.test(path)) return 28 * 1024 * 1024
  if (/^\/api\/collection\/streams\/[^/]+\/subscription$/.test(path)) return 256 * 1024
  if (path.startsWith("/api/settings/")) return 20 * 1024
  return 64 * 1024
}
