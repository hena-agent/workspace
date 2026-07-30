export * as ProjectV2 from "./project"
export * as Project from "./project"

import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm"
import { Cause, Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { isSqlError } from "effect/unstable/sql/SqlError"
import path from "path"
import { Database } from "./database/database"
import { AbsolutePath } from "./schema"
import { FSUtil } from "./fs-util"
import { Git } from "./git"
import { Global } from "./global"
import { makeGlobalNode } from "./effect/app-node"
import { SessionContextEpochTable, SessionTable } from "./session/sql"
import { Hash } from "./util/hash"
import { ProjectDirectories } from "./project/directories"
import { ProjectSchema } from "./project/schema"
import { ProjectTable } from "./project/sql"

export const ID = ProjectSchema.ID
export type ID = ProjectSchema.ID

export const Name = ProjectSchema.Name
export type Name = ProjectSchema.Name

export const Vcs = ProjectSchema.Vcs
export type Vcs = ProjectSchema.Vcs

export class Info extends Schema.Class<Info>("Project.Info")({
  id: ID,
}) {}

export const ManagedInfo = ProjectSchema.ManagedInfo
export type ManagedInfo = ProjectSchema.ManagedInfo

export class InvalidNameError extends Schema.TaggedErrorClass<InvalidNameError>()("Project.InvalidNameError", {
  name: Schema.String,
}) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Project.NotFoundError", {
  projectID: ID,
}) {}

export class InvalidFolderError extends Schema.TaggedErrorClass<InvalidFolderError>()("Project.InvalidFolderError", {
  folder: Schema.String,
}) {}

export class FolderConflictError extends Schema.TaggedErrorClass<FolderConflictError>()("Project.FolderConflictError", {
  projectID: ID,
  folder: Schema.optional(AbsolutePath),
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
  readonly list: () => Effect.Effect<ReadonlyArray<ManagedInfo>>
  readonly get: (projectID: ID) => Effect.Effect<ManagedInfo, NotFoundError>
  readonly create: (input: {
    readonly name?: string
    readonly folder?: string
  }) => Effect.Effect<ManagedInfo, InvalidNameError | InvalidFolderError | FolderConflictError>
  readonly attachFolder: (input: {
    readonly projectID: ID
    readonly folder: string
  }) => Effect.Effect<ManagedInfo, NotFoundError | InvalidFolderError | FolderConflictError>
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
    const fs = yield* FSUtil.Service
    const git = yield* Git.Service
    const global = yield* Global.Service
    const projectDirectories = yield* ProjectDirectories.Service

    const fromRow = (row: typeof ProjectTable.$inferSelect) =>
      ProjectSchema.ManagedInfo.make({
        id: row.id,
        name: ProjectSchema.Name.make(row.name!),
        worktree: row.folder ?? row.worktree,
        folder: row.folder ?? undefined,
        time: {
          created: DateTime.makeUnsafe(row.time_created),
          updated: DateTime.makeUnsafe(row.time_updated),
        },
      })

    const list = Effect.fn("Project.list")(function* () {
      const rows = yield* db
        .select()
        .from(ProjectTable)
        .where(eq(ProjectTable.managed, true))
        .orderBy(desc(ProjectTable.time_updated), desc(ProjectTable.time_created))
        .all()
        .pipe(Effect.orDie)
      return rows.map(fromRow)
    })

    const get = Effect.fn("Project.get")(function* (projectID: ID) {
      const row = yield* db
        .select()
        .from(ProjectTable)
        .where(and(eq(ProjectTable.id, projectID), eq(ProjectTable.managed, true)))
        .get()
        .pipe(Effect.orDie)
      if (!row) return yield* new NotFoundError({ projectID })
      return fromRow(row)
    })

    const resolveFolder = Effect.fnUntraced(function* (input: string) {
      if (!path.isAbsolute(input)) return yield* new InvalidFolderError({ folder: input })
      const folder = AbsolutePath.make(yield* fs.resolve(input))
      if (!(yield* fs.isDir(folder))) return yield* new InvalidFolderError({ folder: input })
      return folder
    })

    const create = Effect.fn("Project.create")(function* (input: { readonly name?: string; readonly folder?: string }) {
      const id = ID.create()
      const folder = input.folder ? yield* resolveFolder(input.folder) : undefined
      const name = input.name?.trim() || (folder ? path.basename(folder) || folder : undefined)
      if (!name) return yield* new InvalidNameError({ name: input.name ?? "" })
      if (folder) {
        const used = yield* db
          .select({ projectID: ProjectTable.id })
          .from(ProjectTable)
          .where(eq(ProjectTable.folder, folder))
          .get()
          .pipe(Effect.orDie)
        if (used) return yield* new FolderConflictError({ projectID: used.projectID, folder })
      }
      const worktree = AbsolutePath.make(path.join(global.data, "projects", id))
      yield* fs.makeDirectory(worktree, { recursive: true, mode: 0o700 }).pipe(Effect.orDie)
      if (process.platform !== "win32") yield* fs.chmod(worktree, 0o700).pipe(Effect.orDie)
      const row = yield* db
        .insert(ProjectTable)
        .values({ id, name, worktree, managed: true, folder, sandboxes: [] })
        .returning()
        .get()
        .pipe(
          Effect.catchTag("EffectDrizzleQueryError", (error) => {
            const cause = Cause.isCause(error.cause)
              ? Option.getOrUndefined(Cause.findErrorOption(error.cause))
              : undefined
            if (!folder || !isSqlError(cause) || cause.reason._tag !== "UniqueViolation") return Effect.die(error)
            return db
              .select({ projectID: ProjectTable.id })
              .from(ProjectTable)
              .where(eq(ProjectTable.folder, folder))
              .get()
              .pipe(
                Effect.orDie,
                Effect.tap(() => fs.remove(worktree, { recursive: true, force: true }).pipe(Effect.ignore)),
                Effect.flatMap((existing) =>
                  existing
                    ? Effect.fail(new FolderConflictError({ projectID: existing.projectID, folder }))
                    : Effect.die(error),
                ),
              )
          }),
        )
      return fromRow(row)
    })

    const attachFolder = Effect.fn("Project.attachFolder")(function* (input: {
      readonly projectID: ID
      readonly folder: string
    }) {
      const folder = yield* resolveFolder(input.folder)

      return yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const row = yield* tx
              .select()
              .from(ProjectTable)
              .where(and(eq(ProjectTable.id, input.projectID), eq(ProjectTable.managed, true)))
              .get()
              .pipe(Effect.orDie)
            if (!row) return yield* new NotFoundError({ projectID: input.projectID })
            if (row.folder) return yield* new FolderConflictError({ projectID: input.projectID, folder: row.folder })

            const used = yield* tx
              .select({ projectID: ProjectTable.id })
              .from(ProjectTable)
              .where(and(eq(ProjectTable.folder, folder), ne(ProjectTable.id, input.projectID)))
              .get()
              .pipe(Effect.orDie)
            if (used) return yield* new FolderConflictError({ projectID: input.projectID, folder })

            const now = Date.now()
            const updated = yield* tx
              .update(ProjectTable)
              .set({ folder, time_updated: now })
              .where(and(eq(ProjectTable.id, input.projectID), isNull(ProjectTable.folder)))
              .returning()
              .get()
              .pipe(Effect.orDie)
            if (!updated) return yield* new FolderConflictError({ projectID: input.projectID })

            // Transitional direct projection update: Project cannot publish Session events without an Event/Project cycle.
            const sessions = yield* tx
              .select({ id: SessionTable.id, directory: SessionTable.directory })
              .from(SessionTable)
              .where(eq(SessionTable.project_id, input.projectID))
              .all()
              .pipe(Effect.orDie)
            yield* Effect.forEach(sessions, (session) => {
              const directory = inside(row.worktree, session.directory)
                ? AbsolutePath.make(path.join(folder, path.relative(row.worktree, session.directory)))
                : session.directory
              return tx
                .update(SessionTable)
                .set({ directory, mode: null, time_updated: now })
                .where(eq(SessionTable.id, session.id))
                .run()
                .pipe(Effect.orDie)
            })
            if (sessions.length > 0)
              yield* tx
                .delete(SessionContextEpochTable)
                .where(
                  inArray(
                    SessionContextEpochTable.session_id,
                    sessions.map((session) => session.id),
                  ),
                )
                .run()
                .pipe(Effect.orDie)
            return fromRow(updated)
          }),
        )
        .pipe(Effect.catchTag("SqlError", Effect.die))
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
        .select()
        .from(ProjectTable)
        .where(eq(ProjectTable.managed, true))
        .all()
        .pipe(Effect.orDie)
      const match = managed
        .flatMap((row) =>
          [row.worktree, row.folder]
            .filter((root): root is AbsolutePath => root !== null)
            .map((root) => ({ row, root })),
        )
        .filter((candidate) => inside(candidate.root, directory))
        .sort((a, b) => b.root.length - a.root.length)[0]
      if (match) {
        const repo = yield* git.repo.discover(directory)
        return {
          id: match.row.id,
          directory: match.root,
          vcs: repo ? { type: "git" as const, store: repo.commonDirectory } : undefined,
        }
      }

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

    return Service.of({ list, get, create, attachFolder, directories, resolve, commit })
  }),
)

function inside(root: string, target: string) {
  const relative = path.relative(root, target)
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

export const node = makeGlobalNode({
  service: Service,
  layer: layer,
  deps: [Database.node, FSUtil.node, Git.node, Global.node, ProjectDirectories.node],
})
