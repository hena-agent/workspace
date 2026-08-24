import { cors } from "hono/cors"

export function exactOriginCors(origins: readonly string[]) {
  const allowed = new Set(origins)
  const middleware = cors({
    origin: (origin, context) => isAllowed(origin, context.req.url, allowed) ? origin : "",
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    maxAge: 600,
  })
  return async (context: Parameters<typeof middleware>[0], next: Parameters<typeof middleware>[1]) => {
    const origin = context.req.header("origin")
    if (origin && !isAllowed(origin, context.req.url, allowed))
      return context.json({ error: { code: "unauthorized", message: "Origin is not allowed" } }, 401)
    return middleware(context, next)
  }
}

function isAllowed(origin: string, requestURL: string, allowed: ReadonlySet<string>) {
  if (allowed.has(origin)) return true
  const parsed = URL.parse(origin)
  if (!parsed) return false
  const request = new URL(requestURL)
  return parsed.origin === request.origin && isLoopback(request.hostname)
}

function isLoopback(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
}
