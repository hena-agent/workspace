import { cors } from "hono/cors"

export function exactOriginCors(origins: readonly string[]) {
  const allowed = new Set(origins)
  const middleware = cors({
    origin: (origin) => allowed.has(origin) ? origin : "",
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    maxAge: 600,
  })
  return async (context: Parameters<typeof middleware>[0], next: Parameters<typeof middleware>[1]) => {
    const origin = context.req.header("origin")
    if (origin && !allowed.has(origin))
      return context.json({ error: { code: "unauthorized", message: "Origin is not allowed" } }, 401)
    return middleware(context, next)
  }
}
