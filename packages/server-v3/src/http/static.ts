import { isAbsolute, normalize, resolve, sep } from "node:path"
import { Hono } from "hono"

export type StaticFiles = Readonly<Record<string, string>>

export function createStaticRoutes(input: { publicDir?: string; publicFiles?: StaticFiles }) {
  return new Hono().get("*", async (c) => {
    if (c.req.path.startsWith("/api")) return c.notFound()
    const pathname = decodePath(c.req.path)
    if (pathname === undefined) return c.notFound()
    const index = await staticFile(input, "index.html")
    const relative = safeRelativePath(pathname)
    const requestedFile = relative === undefined ? undefined : await staticFile(input, relative)
    if (!requestedFile && isAssetPath(c.req.path)) return c.notFound()
    const file = requestedFile ?? index
    if (!file) return c.text("app-v3 is not built; run `bun run build` from packages/app-v3", 503)
    c.header("Cache-Control", cacheControl(c.req.path, file === index))
    return new Response(file, { headers: c.res.headers })
  })
}

function isAssetPath(pathname: string) {
  return pathname.startsWith("/assets/") || pathname.split("/").at(-1)?.includes(".") === true
}

async function staticFile(input: { publicDir?: string; publicFiles?: StaticFiles }, relative: string) {
  const embedded = input.publicFiles?.[relative]
  if (embedded) return Bun.file(embedded)
  if (!input.publicDir) return undefined
  const file = Bun.file(resolve(input.publicDir, relative))
  return (await file.exists()) ? file : undefined
}

function safeRelativePath(pathname: string) {
  const relative = normalize(pathname).replace(/^[/\\]+/, "")
  const root = resolve("/")
  const target = resolve(root, relative)
  if (isAbsolute(relative) || target === root || !target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`))
    return undefined
  return relative
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
