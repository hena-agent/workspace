import { Sync } from "@hena/schema/sync"
import { sValidator } from "@hono/standard-validator"
import { Schema } from "effect"
import { Hono } from "hono"
import type { CoreDomain } from "../core/domain"
import { error, validationHook } from "../http/error"

export function createFileSystemRoutes(domain: CoreDomain) {
  return new Hono()
    .get("/fs/list", sValidator("query", Schema.toStandardSchemaV1(Sync.FileListQuery), validationHook), async (c) => {
      const input = c.req.valid("query")
      return domain
        .listFiles(input)
        .then((data) => c.json({ data: data.slice(0, input.limit ?? 1_000) }))
        .catch((cause) => fileSystemError(c, cause))
    })
    .get("/fs/find", sValidator("query", Schema.toStandardSchemaV1(Sync.FileFindQuery), validationHook), async (c) =>
      domain
        .findFiles(c.req.valid("query"))
        .then((data) => c.json({ data }))
        .catch((cause) => fileSystemError(c, cause)),
    )
}

function fileSystemError(c: Parameters<typeof error>[0], cause: unknown) {
  const code = fileSystemCode(cause)
  if ((isPlatformError(cause) && cause.reason === "NotFound") || code === "ENOENT")
    return error(c, 404, "not_found", "Path not found")
  if (
    isPlatformError(cause) ||
    code === "EACCES" ||
    code === "EPERM" ||
    code === "ENOTDIR" ||
    (cause instanceof Error &&
      (cause.message === "Path is not a directory" ||
        cause.message === "Path escapes the location" ||
        cause.message === "Location is unavailable"))
  )
    return error(c, 400, "validation", "Path is unavailable")
  throw cause
}

function isPlatformError(cause: unknown): cause is { _tag: "PlatformError"; reason?: string } {
  return typeof cause === "object" && cause !== null && "_tag" in cause && cause._tag === "PlatformError"
}

function fileSystemCode(cause: unknown) {
  if (typeof cause !== "object" || cause === null || !("_tag" in cause) || cause._tag !== "FileSystemError")
    return undefined
  if (!("cause" in cause) || typeof cause.cause !== "object" || cause.cause === null || !("code" in cause.cause))
    return undefined
  return typeof cause.cause.code === "string" ? cause.cause.code : undefined
}
