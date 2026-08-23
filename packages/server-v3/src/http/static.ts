import { isAbsolute, normalize, resolve, sep } from "node:path"
import { Hono } from "hono"

export function createStaticRoutes(publicDir: string) {
  return new Hono().get("*", async (c) => {
    if (c.req.path.startsWith("/api")) return c.notFound()
    const index = Bun.file(resolve(publicDir, "index.html"))
    const requested = safePath(publicDir, c.req.path)
    const file = requested && await Bun.file(requested).exists() ? Bun.file(requested) : await index.exists() ? index : undefined
    if (!file) return c.text("app-v3 is not built; run `bun run build` from packages/app-v3", 503)
    c.header("Cache-Control", cacheControl(c.req.path, file === index))
    return new Response(file, { headers: c.res.headers })
  })
}

function safePath(root: string, pathname: string) {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, "")
  const base = resolve(root)
  const target = resolve(base, relative)
  if (isAbsolute(relative) || target === base || !target.startsWith(base.endsWith(sep) ? base : `${base}${sep}`))
    return undefined
  return target
}

function cacheControl(pathname: string, index: boolean) {
  if (index || pathname === "/manifest.webmanifest" || pathname.endsWith("/sw.js")) return "no-cache"
  if (pathname.startsWith("/assets/")) return "public, max-age=31536000, immutable"
  return "no-cache"
}
