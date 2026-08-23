import { cors } from "hono/cors"

export function exactOriginCors(origins: readonly string[]) {
  const allowed = new Set(origins)
  return cors({
    origin: (origin) => allowed.has(origin) ? origin : "",
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    maxAge: 600,
  })
}
