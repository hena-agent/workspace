import { isAbsolute, relative, resolve, sep } from "node:path"
import { Hono } from "hono"

export type StaticSource =
  | { type: "disk"; directory: string }
  | { type: "embedded"; files: Readonly<Record<string, string>> }

const ContentSecurityPolicy =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; media-src 'self' data: blob:; connect-src * data:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"

export function createStaticRoutes(source: StaticSource) {
  const resolveFile = staticResolver(source)
  return new Hono().get("*", async (c) => {
    if (c.req.path.startsWith("/api")) return c.notFound()
    const pathname = decodePath(c.req.path)
    if (pathname === undefined) return c.notFound()
    c.header("Content-Security-Policy", ContentSecurityPolicy)
    const requested = safeRelativePath(pathname)
    const requestedFile = requested === undefined ? undefined : await resolveFile(requested)
    if (!requestedFile && isAssetPath(c.req.path)) return c.notFound()
    const file = requestedFile ?? (await resolveFile("index.html"))
    if (!file) return c.text("app-v3 is not built; run `bun run build:embedded` from packages/app-v3", 503)
    c.header("Cache-Control", cacheControl(c.req.path, !requestedFile))
    return new Response(file, { headers: c.res.headers })
  })
}

function isAssetPath(pathname: string) {
  return pathname.startsWith("/assets/") || pathname.split("/").at(-1)?.includes(".") === true
}

function staticResolver(source: StaticSource) {
  if (source.type === "embedded")
    return async (requested: string) => {
      if (!Object.hasOwn(source.files, requested)) return undefined
      const file = Bun.file(source.files[requested])
      return (await file.exists()) ? file : undefined
    }

  const root = resolve(source.directory)
  return async (requested: string) => {
    const target = resolve(root, requested)
    const nested = relative(root, target)
    if (!nested || nested === ".." || nested.startsWith(`..${sep}`) || isAbsolute(nested)) return undefined
    const file = Bun.file(target)
    return (await file.exists()) ? file : undefined
  }
}

function safeRelativePath(pathname: string) {
  if (pathname.includes("\\")) return undefined
  const requested = pathname.replace(/^\/+/, "")
  if (!requested || requested.split("/").includes("..") || isAbsolute(requested)) return undefined
  return requested
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
