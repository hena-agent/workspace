export * as FileSystem from "./filesystem"

import { makeLocationNode } from "./effect/app-node"
import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { FSUtil } from "./fs-util"
import { Location } from "./location"
import { PositiveInt, RelativePath } from "./schema"
import { FileSystemSearch } from "./filesystem/search"
import { Entry, FileSystem, FindInput, Match } from "@hena/schema/filesystem"
export { Entry, Match, Submatch } from "@hena/schema/filesystem"

export const ReadInput = Schema.Struct({
  path: RelativePath,
})
export type ReadInput = typeof ReadInput.Type

export const Content = Schema.Struct({
  uri: Schema.String,
  name: Schema.String.pipe(Schema.optional),
  content: Schema.String,
  encoding: Schema.Literals(["utf8", "base64"]),
  mime: Schema.String,
}).annotate({ identifier: "FileSystem.Content" })
export type Content = typeof Content.Type

export const ListInput = Schema.Struct({
  path: RelativePath.pipe(Schema.optional),
  limit: PositiveInt.pipe(Schema.optional),
})
export type ListInput = typeof ListInput.Type

export { FindInput }

export class GlobInput extends Schema.Class<GlobInput>("FileSystem.GlobInput")({
  pattern: Schema.String,
  path: RelativePath.pipe(Schema.optional),
  limit: PositiveInt.pipe(Schema.optional),
}) {}

export class GrepInput extends Schema.Class<GrepInput>("FileSystem.GrepInput")({
  pattern: Schema.String,
  path: RelativePath.pipe(Schema.optional),
  include: Schema.String.pipe(Schema.optional),
  limit: PositiveInt.pipe(Schema.optional),
}) {}

export const Event = FileSystem.Event

export interface Interface {
  readonly read: (input: ReadInput) => Effect.Effect<{ readonly content: Uint8Array; readonly mime: string }>
  readonly list: (input?: ListInput) => Effect.Effect<Entry[]>
  readonly find: (input: FindInput) => Effect.Effect<Entry[]>
  readonly glob: (input: GlobInput) => Effect.Effect<readonly Entry[]>
  readonly grep: (input: GrepInput) => Effect.Effect<readonly Match[]>
}

export class Service extends Context.Service<Service, Interface>()("@hena/v2/FileSystem") {}

const baseLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const search = yield* FileSystemSearch.Service
    const root = yield* fs.realPath(location.directory).pipe(Effect.orDie)
    const resolve = Effect.fnUntraced(function* (input?: RelativePath) {
      const absolute = path.resolve(location.directory, input ?? ".")
      if (!FSUtil.contains(location.directory, absolute))
        return yield* Effect.die(new Error("Path escapes the location"))
      const real = yield* fs.realPath(absolute).pipe(Effect.orDie)
      if (!FSUtil.contains(root, real)) return yield* Effect.die(new Error("Path escapes the location"))
      return { absolute, real, directory: location.directory, root }
    })
    return Service.of({
      find: search.find,
      glob: search.glob,
      grep: search.grep,
      read: Effect.fn("FileSystem.read")(function* (input) {
        const target = yield* resolve(input.path)
        const info = yield* fs.stat(target.real).pipe(Effect.orDie)
        if (info.type !== "File") return yield* Effect.die(new Error("Path is not a file"))
        return {
          content: yield* fs.readFile(target.real).pipe(Effect.orDie),
          mime: FSUtil.mimeType(target.real),
        }
      }),
      list: Effect.fn("FileSystem.list")(function* (input = {}) {
        const target = yield* resolve(input.path)
        const info = yield* fs.stat(target.real).pipe(Effect.orDie)
        if (info.type !== "Directory") return yield* Effect.die(new Error("Path is not a directory"))
        return yield* fs
          .reduceDirectoryEntries(target.real, [] as Entry[], (best, item) => {
            if (item.type !== "file" && item.type !== "directory") return best
            const absolute = path.join(target.absolute, item.name)
            const relative = path.relative(target.directory, absolute)
            const entry = Entry.make({
              path: RelativePath.make(relative + (item.type === "directory" ? path.sep : "")),
              type: item.type,
            })
            if (input.limit) return retainEntry(best, entry, input.limit)
            best.push(entry)
            return best
          })
          .pipe(
            Effect.orDie,
            Effect.map((entries) => entries.sort(compareEntries)),
          )
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer: baseLayer,
  deps: [FSUtil.node, Location.node, FileSystemSearch.node],
})

function compareEntries(a: Entry, b: Entry) {
  return a.type === b.type ? a.path.localeCompare(b.path) : a.type === "directory" ? -1 : 1
}

function retainEntry(entries: Entry[], entry: Entry, limit: number) {
  if (entries.length < limit) {
    entries.push(entry)
    for (let index = entries.length - 1; index > 0; ) {
      const parent = Math.floor((index - 1) / 2)
      if (compareEntries(entries[parent], entries[index]) >= 0) break
      ;[entries[parent], entries[index]] = [entries[index], entries[parent]]
      index = parent
    }
    return entries
  }
  if (compareEntries(entry, entries[0]) >= 0) return entries
  entries[0] = entry
  for (let index = 0; ; ) {
    const left = index * 2 + 1
    if (left >= entries.length) break
    const right = left + 1
    const child = right < entries.length && compareEntries(entries[right], entries[left]) > 0 ? right : left
    if (compareEntries(entries[index], entries[child]) >= 0) break
    ;[entries[index], entries[child]] = [entries[child], entries[index]]
    index = child
  }
  return entries
}
