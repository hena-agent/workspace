import { isAbsolute, normalize, resolve, sep } from "node:path"
import { Hono } from "hono"

export function createStaticRoutes(publicDir: string) {
  return new Hono().get("*", async (c) => {
    if (c.req.path.startsWith("/api")) return c.notFound()
    const pathname = decodePath(c.req.path)
    if (pathname === undefined) return c.notFound()
    const index = Bun.file(resolve(publicDir, "index.html"))
    const requested = safePath(publicDir, pathname)
    const requestedFile = requested && await Bun.file(requested).exists() ? Bun.file(requested) : undefined
    if (!requestedFile && isAssetPath(c.req.path)) return c.notFound()
    const file = requestedFile ?? ((await index.exists()) ? index : undefined)
    if (!file) return c.text("app-v3 is not built; run `bun run build` from packages/app-v3", 503)
    c.header("Cache-Control", cacheControl(c.req.path, file === index))
    return new Response(file, { headers: c.res.headers })
  })
}

function isAssetPath(pathname: string) {
  return pathname.startsWith("/assets/") || pathname.split("/").at(-1)?.includes(".") === true
}

function safePath(root: string, pathname: string) {
  const relative = normalize(pathname).replace(/^[/\\]+/, "")
  const base = resolve(root)
  const target = resolve(base, relative)
  if (isAbsolute(relative) || target === base || !target.startsWith(base.endsWith(sep) ? base : `${base}${sep}`))
    return undefined
  return target
}

function decodePath(pathname: string) {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return undefined
  }
}

function cacheControl(pathname: string, index: boolean) {
  if (index || pathname === "/manifest.webmanifest" || pathname.endsWith("/sw.js")) return "no-cache"
  if (pathname.startsWith("/assets/") && /-[A-Za-z0-9_-]{6,}\.[^/]+$/.test(pathname))
    return "public, max-age=31536000, immutable"
  return "no-cache"
}
