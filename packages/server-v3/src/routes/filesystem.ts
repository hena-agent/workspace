import { Sync } from "@hena/schema/sync"
import { sValidator } from "@hono/standard-validator"
import { Schema } from "effect"
import { Hono } from "hono"
import { realpath, stat } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import type { CoreDomain } from "../core/domain"
import { error, validationHook } from "../http/error"

const ResolveDirectoryQuery = Schema.Struct({
  path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4_096)),
})

export function createFileSystemRoutes(domain: CoreDomain) {
  return new Hono()
    .get(
      "/fs/resolve",
      sValidator("query", Schema.toStandardSchemaV1(ResolveDirectoryQuery), validationHook),
      async (c) => {
        const input = c.req.valid("query").path
        const expanded = input === "~"
          ? homedir()
          : input.startsWith("~/") || input.startsWith("~\\")
            ? path.join(homedir(), input.slice(2))
            : input
        if (!path.isAbsolute(expanded)) return error(c, 400, "validation", "Enter an absolute directory path")
        return realpath(expanded)
          .then(async (directory) =>
            (await stat(directory)).isDirectory()
              ? c.json({ directory })
              : error(c, 400, "validation", "Path is not a directory"),
          )
          .catch((cause) => fileSystemError(c, cause))
      },
    )
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
    .get("/fs/read", sValidator("query", Schema.toStandardSchemaV1(Sync.FileReadQuery), validationHook), async (c) =>
      domain
        .readFile(c.req.valid("query"))
        .then((data) => c.json(data))
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
  if (typeof cause !== "object" || cause === null) return undefined
  if ("code" in cause && typeof cause.code === "string") return cause.code
  if (!("_tag" in cause) || cause._tag !== "FileSystemError") return undefined
  if (!("cause" in cause) || typeof cause.cause !== "object" || cause.cause === null || !("code" in cause.cause))
    return undefined
  return typeof cause.cause.code === "string" ? cause.cause.code : undefined
}
