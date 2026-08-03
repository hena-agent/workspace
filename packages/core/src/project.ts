export * as ProjectV2 from "./project"
export * as Project from "./project"

import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import { Context, DateTime, Effect, Exit, Layer, Schema } from "effect"
import path from "path"
import { Database } from "./database/database"
import { EventV2 } from "./event"
import { AbsolutePath } from "./schema"
import { FSUtil } from "./fs-util"
import { Git } from "./git"
import { Global } from "./global"
import { makeGlobalNode } from "./effect/app-node"
import { Hash } from "./util/hash"
import { ProjectDirectories } from "./project/directories"
import { ProjectSchema } from "./project/schema"
import { ProjectDirectoryTable, ProjectTable } from "./project/sql"

export const ID = ProjectSchema.ID
export type ID = ProjectSchema.ID

export const Vcs = ProjectSchema.Vcs
export type Vcs = ProjectSchema.Vcs

export const Chat = ProjectSchema.Chat
export type Chat = ProjectSchema.Chat

export const CreateInput = ProjectSchema.CreateInput
export type CreateInput = ProjectSchema.CreateInput

export const Event = ProjectSchema.Event

export class Info extends Schema.Class<Info>("Project.Info")({
  id: ID,
}) {}

export const DirectoriesInput = ProjectDirectories.ListInput
export type DirectoriesInput = typeof DirectoriesInput.Type

export const Directories = ProjectDirectories.ListOutput
export type Directories = typeof Directories.Type

export interface Resolved {
  readonly previous?: ID
  readonly id: ID
  readonly directory: AbsolutePath
  readonly vcs?: Vcs
}

export interface Interface {
  readonly list: () => Effect.Effect<ReadonlyArray<Chat>>
  readonly isFolderless: (projectID: ID) => Effect.Effect<boolean>
  readonly create: (input: CreateInput) => Effect.Effect<Chat>
  readonly directories: (input: DirectoriesInput) => Effect.Effect<Directories>
  readonly resolve: (input: AbsolutePath) => Effect.Effect<Resolved>
  /**
   * Temporary bridge method for writing the resolved project ID to the repo-local cache.
   *
   * This exists while the legacy project service and this core project
   * service work together: core resolves the ID, while the old service still owns
   * database migration and persistence. The old service should call this after it
   * finishes migrating from `resolve().previous` to `resolve().id`; once project
   * persistence moves into core, this separate bridge method can go away.
   */
  readonly commit: (input: { store: AbsolutePath; id: ID }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@hena/ProjectV2") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const events = yield* EventV2.Service
    const fs = yield* FSUtil.Service
    const git = yield* Git.Service
    const global = yield* Global.Service
    const projectDirectories = yield* ProjectDirectories.Service

    const list = Effect.fn("Project.list")(function* () {
      const rows = yield* db
        .select({ project: ProjectTable, directory: ProjectDirectoryTable.directory })
        .from(ProjectTable)
        .innerJoin(ProjectDirectoryTable, eq(ProjectDirectoryTable.project_id, ProjectTable.id))
        .where(and(isNull(ProjectTable.worktree), eq(ProjectDirectoryTable.type, "main")))
        .orderBy(desc(ProjectTable.time_updated), desc(ProjectTable.time_created))
        .all()
        .pipe(Effect.orDie)
      return rows.map(fromChatRow)
    })

    const isFolderless = Effect.fn("Project.isFolderless")(function* (projectID: ID) {
      return (
        (yield* db
          .select({ id: ProjectTable.id })
          .from(ProjectTable)
          .where(and(eq(ProjectTable.id, projectID), isNull(ProjectTable.worktree)))
          .get()
          .pipe(Effect.orDie)) !== undefined
      )
    })

    const create = Effect.fn("Project.create")(function* (input: CreateInput) {
      const id = ID.create()
      const scratch = AbsolutePath.make(path.join(global.data, "projects", id))
      const chat = yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const directory = yield* restore(
            Effect.gen(function* () {
              yield* fs.makeDirectory(scratch, { recursive: true, mode: 0o700 }).pipe(Effect.orDie)
              const directory = AbsolutePath.make(yield* fs.resolve(scratch))
              if (process.platform !== "win32") yield* fs.chmod(directory, 0o700).pipe(Effect.orDie)
              return directory
            }),
          )
          const row = yield* db
            .transaction((tx) =>
              Effect.gen(function* () {
                const project = yield* tx
                  .insert(ProjectTable)
                  .values({ id, name: input.name, worktree: null, sandboxes: [] })
                  .returning()
                  .get()
                yield* tx.insert(ProjectDirectoryTable).values({ project_id: id, directory, type: "main" }).run()
                return project
              }),
            )
            .pipe(Effect.orDie)
          return fromChatRow({ project: row, directory })
        }).pipe(
          Effect.onExit((exit) =>
            Exit.isFailure(exit)
              ? fs.remove(scratch, { recursive: true, force: true }).pipe(Effect.ignore)
              : Effect.void,
          ),
        ),
      )
      yield* events
        .publish(ProjectSchema.Event.ChatCreated, chat, { isolateListeners: true })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logError("Project notification listener failed", cause).pipe(
              Effect.annotateLogs({ projectID: chat.id, eventType: ProjectSchema.Event.ChatCreated.type }),
            ),
          ),
        )
      return chat
    })

    const directories = Effect.fn("Project.directories")(function* (input: DirectoriesInput) {
      return yield* projectDirectories.list(input.projectID)
    })

    const cached = Effect.fnUntraced(function* (dir: string) {
      return yield* fs.readFileString(path.join(dir, "hena")).pipe(
        Effect.map((value) => value.trim()),
        Effect.map((value) => (value ? ID.make(value) : undefined)),
        Effect.catch(() => Effect.succeed(undefined)),
      )
    })

    const remote = Effect.fnUntraced(function* (repo: Git.Repository) {
      const origin = yield* git.remote.get(repo)
      if (!origin) return undefined
      const normalized = url(origin)
      if (!normalized) return undefined
      return ID.make(Hash.fast(`git-remote:${normalized}`))
    })

    function url(input: string) {
      const value = input.trim()
      if (!value) return undefined

      try {
        const parsed = new URL(value)
        if (parsed.protocol === "file:") return undefined
        return parts(parsed.hostname, parsed.pathname)
      } catch {
        const scp = value.match(/^([^@/:]+@)?([^/:]+):(.+)$/)
        if (scp) return parts(scp[2], scp[3])
        return undefined
      }
    }

    function parts(host: string, name: string) {
      const pathname = name
        .replace(/^\/+/, "")
        .replace(/\.git\/?$/, "")
        .replace(/\/+$/, "")
      if (!host || !pathname) return undefined
      return `${host.toLowerCase()}/${pathname}`
    }

    const root = Effect.fnUntraced(function* (repo: Git.Repository) {
      const root = (yield* git.history.rootCommits(repo))[0]
      return root ? ID.make(root) : undefined
    })

    const resolve = Effect.fn("Project.resolve")(function* (input: AbsolutePath) {
      const directory = AbsolutePath.make(yield* fs.resolve(input))
      const managed = yield* db
        .select({ id: ProjectTable.id, directory: ProjectDirectoryTable.directory })
        .from(ProjectTable)
        .innerJoin(ProjectDirectoryTable, eq(ProjectDirectoryTable.project_id, ProjectTable.id))
        .where(and(isNull(ProjectTable.worktree), inArray(ProjectDirectoryTable.directory, ancestorPaths(directory))))
        .all()
        .pipe(Effect.orDie)
      const match = managed.sort((a, b) => b.directory.length - a.directory.length)[0]
      if (match) return { id: match.id, directory: match.directory, vcs: undefined }

      const repo = yield* git.repo.discover(input)
      if (!repo) return { id: ID.global, directory: AbsolutePath.make(path.parse(input).root), vcs: undefined }

      const previous = yield* cached(repo.commonDirectory)
      const id = (yield* remote(repo)) ?? previous ?? (yield* root(repo))
      return {
        previous,
        id: id ?? ID.global,
        directory: repo.worktree,
        vcs: { type: "git" as const, store: repo.commonDirectory },
      }
    })

    const commit = Effect.fn("Project.commit")(function* (input: { store: AbsolutePath; id: ID }) {
      yield* fs.writeFileString(path.join(input.store, "hena"), input.id).pipe(Effect.ignore)
    })

    return Service.of({ list, isFolderless, create, directories, resolve, commit })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer: layer,
  deps: [Database.node, EventV2.node, FSUtil.node, Git.node, Global.node, ProjectDirectories.node],
})

function fromChatRow(input: { project: typeof ProjectTable.$inferSelect; directory: AbsolutePath }) {
  return ProjectSchema.Chat.make({
    id: input.project.id,
    name: Schema.decodeUnknownSync(ProjectSchema.Name)(input.project.name),
    directory: input.directory,
    time: {
      created: DateTime.makeUnsafe(input.project.time_created),
      updated: DateTime.makeUnsafe(input.project.time_updated),
    },
  })
}

function ancestorPaths(directory: AbsolutePath): AbsolutePath[] {
  const parent = AbsolutePath.make(path.dirname(directory))
  return parent === directory ? [directory] : [directory, ...ancestorPaths(parent)]
}
