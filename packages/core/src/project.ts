export * as ProjectV2 from "./project"
export * as Project from "./project"

import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import { Context, DateTime, Effect, Exit, Layer, Option, Schema } from "effect"
import path from "path"
import { Database } from "./database/database"
import { EventV2 } from "./event"
import { EventTable } from "./event/sql"
import { makeGlobalNode } from "./effect/app-node"
import { FSUtil } from "./fs-util"
import { Git } from "./git"
import { Global } from "./global"
import { ProjectDirectories } from "./project/directories"
import { ProjectSchema } from "./project/schema"
import { ProjectDirectoryTable, ProjectTable } from "./project/sql"
import { AbsolutePath, RelativePath } from "./schema"
import { SessionSchema } from "./session/schema"
import { SessionEvent } from "./session/event"
import { SessionContextEpochTable, SessionTable } from "./session/sql"
import { Hash } from "./util/hash"

export const ID = ProjectSchema.ID
export type ID = ProjectSchema.ID

export const Vcs = ProjectSchema.Vcs
export type Vcs = ProjectSchema.Vcs

export class Info extends Schema.Class<Info>("Project.Info")({
  id: ID,
}) {}

export class InvalidNameError extends Schema.TaggedErrorClass<InvalidNameError>()("Project.InvalidNameError", {
  name: Schema.String,
}) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Project.NotFoundError", {
  projectID: ID,
}) {}

export class InvalidFolderError extends Schema.TaggedErrorClass<InvalidFolderError>()("Project.InvalidFolderError", {
  folder: Schema.String,
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
  readonly list: () => Effect.Effect<ReadonlyArray<ProjectSchema.Chat>>
  readonly isFolderless: (projectID: ID) => Effect.Effect<boolean>
  readonly create: (input: { readonly name: string }) => Effect.Effect<ProjectSchema.Chat, InvalidNameError>
  readonly attachFolder: (input: {
    readonly projectID: ID
    readonly folder: string
  }) => Effect.Effect<ProjectSchema.Attachment, NotFoundError | InvalidFolderError>
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
        .where(isNull(ProjectTable.worktree))
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

    const create = Effect.fn("Project.create")(function* (input: { readonly name: string }) {
      const name = input.name.trim()
      if (!name) return yield* new InvalidNameError({ name: input.name })
      const id = ID.create()
      const scratch = AbsolutePath.make(path.join(global.data, "projects", id))
      return yield* Effect.uninterruptibleMask((restore) =>
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
                  .values({ id, name, worktree: null, sandboxes: [] })
                  .returning()
                  .get()
                yield* tx
                  .insert(ProjectDirectoryTable)
                  .values({ project_id: id, directory, type: "main" })
                  .run()
                return project
              }),
            )
            .pipe(Effect.orDie)
          const chat = fromChatRow({ project: row, directory })
          yield* events.publish(ProjectSchema.Event.ChatCreated, chat)
          return chat
        }).pipe(
          Effect.onExit((exit) =>
            Exit.isFailure(exit) ? fs.remove(scratch, { recursive: true, force: true }).pipe(Effect.ignore) : Effect.void,
          ),
        ),
      )
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
      const ancestors = ancestorPaths(directory)
      const chat = yield* db
        .select({ id: ProjectTable.id, directory: ProjectDirectoryTable.directory })
        .from(ProjectTable)
        .innerJoin(ProjectDirectoryTable, eq(ProjectDirectoryTable.project_id, ProjectTable.id))
        .where(and(isNull(ProjectTable.worktree), inArray(ProjectDirectoryTable.directory, ancestors)))
        .all()
        .pipe(Effect.orDie)
      const match = chat.sort((a, b) => b.directory.length - a.directory.length)[0]
      if (match) return { id: match.id, directory: match.directory, vcs: undefined }

      const repo = yield* git.repo.discover(directory)
      if (!repo) return { id: ID.global, directory: AbsolutePath.make(path.parse(directory).root), vcs: undefined }

      const previous = yield* cached(repo.commonDirectory)
      const id = (yield* remote(repo)) ?? previous ?? (yield* root(repo))
      return {
        previous,
        id: id ?? ID.global,
        directory: repo.worktree,
        vcs: { type: "git" as const, store: repo.commonDirectory },
      }
    })

    const attachFolder = Effect.fn("Project.attachFolder")(function* (input) {
      const selected = yield* resolveFolder(fs, input.folder)
      const destination = yield* resolve(selected)
      if (destination.id === input.projectID) return yield* new InvalidFolderError({ folder: input.folder })
      const directory = destination.vcs ? destination.directory : selected
      const timestamp = yield* DateTime.now
      return yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const destinationProject = yield* tx
              .select({ worktree: ProjectTable.worktree })
              .from(ProjectTable)
              .where(eq(ProjectTable.id, destination.id))
              .get()
            if (destinationProject?.worktree === null) {
              return yield* new InvalidFolderError({ folder: input.folder })
            }

            const source = yield* tx
              .select({ directory: ProjectDirectoryTable.directory })
              .from(ProjectTable)
              .innerJoin(ProjectDirectoryTable, eq(ProjectDirectoryTable.project_id, ProjectTable.id))
              .where(and(eq(ProjectTable.id, input.projectID), isNull(ProjectTable.worktree)))
              .get()
            if (!source) return yield* reconcileAttachment(input.projectID, destination, directory)

            yield* tx
              .insert(ProjectTable)
              .values({
                id: destination.id,
                worktree: destination.directory,
                vcs: destination.vcs?.type,
                sandboxes: [],
              })
              .onConflictDoNothing()
              .run()

            const sessions = yield* tx
              .select()
              .from(SessionTable)
              .where(eq(SessionTable.project_id, input.projectID))
              .all()
            const movedEvents = yield* Effect.forEach(
              sessions,
              (session) => {
                const relative = path.relative(source.directory, session.directory)
                const subpath =
                  relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ? "" : relative
                const sessionID = SessionSchema.ID.make(session.id)
                const sessionDirectory = AbsolutePath.make(path.resolve(directory, subpath))
                return events.publish(
                  SessionEvent.Moved,
                  {
                    sessionID,
                    projectID: destination.id,
                    location: { directory: sessionDirectory },
                    subdirectory: subpath ? RelativePath.make(subpath) : undefined,
                    timestamp,
                  },
                  {
                    deferBroadcast: true,
                    project: false,
                    commit: () =>
                      Effect.gen(function* () {
                        yield* tx
                          .update(SessionTable)
                          .set({
                            project_id: destination.id,
                            directory: sessionDirectory,
                            path: subpath ? RelativePath.make(subpath) : null,
                            time_updated: DateTime.toEpochMillis(timestamp),
                          })
                          .where(and(eq(SessionTable.id, session.id), eq(SessionTable.project_id, input.projectID)))
                          .run()
                          .pipe(Effect.orDie)
                        yield* tx
                          .delete(SessionContextEpochTable)
                          .where(eq(SessionContextEpochTable.session_id, session.id))
                          .run()
                          .pipe(Effect.orDie)
                      }),
                  },
                )
              },
            )
            const attachment = ProjectSchema.Attachment.make({
              project: { id: destination.id, directory, vcs: destination.vcs?.type },
              sessionIDs: sessions.map((session) => SessionSchema.ID.make(session.id)),
            })
            const attachedEvent = yield* events.publish(
              ProjectSchema.Event.Attached,
              { projectID: input.projectID, attachment, timestamp },
              { deferBroadcast: true },
            )
            yield* tx.delete(ProjectTable).where(eq(ProjectTable.id, input.projectID)).run()
            return {
              attachment,
              scratch: source.directory as AbsolutePath | undefined,
              events: [...movedEvents, attachedEvent],
            }
          }),
        )
        .pipe(
          Effect.catchTags({
            EffectDrizzleQueryError: Effect.die,
            SqlError: Effect.die,
          }),
          Effect.tap((result) => Effect.forEach(result.events, events.broadcast, { discard: true })),
          Effect.uninterruptible,
          Effect.tap((result) =>
            result.scratch
              ? fs.remove(result.scratch, { recursive: true, force: true }).pipe(Effect.ignore)
              : Effect.void,
          ),
          Effect.map((result) => result.attachment),
        )
    })

    const reconcileAttachment = Effect.fnUntraced(function* (
      sourceID: ID,
      destination: Resolved,
      directory: AbsolutePath,
    ) {
      const rows = yield* db
        .select({ data: EventTable.data })
        .from(EventTable)
        .where(
          and(
            eq(EventTable.aggregate_id, sourceID),
            eq(EventTable.type, EventV2.versionedType(ProjectSchema.Event.Attached.type, 1)),
          ),
        )
        .all()
      const receipt = rows.flatMap((row) =>
        Option.toArray(Schema.decodeUnknownOption(ProjectSchema.Event.Attached.data)(row.data)),
      )[0]
      if (!receipt) return yield* new NotFoundError({ projectID: sourceID })
      if (receipt.attachment.project.id !== destination.id || receipt.attachment.project.directory !== directory)
        return yield* new NotFoundError({ projectID: sourceID })
      return {
        attachment: receipt.attachment,
        scratch: undefined,
        events: [],
      }
    })

    const directories = Effect.fn("Project.directories")(function* (input: DirectoriesInput) {
      return yield* projectDirectories.list(input.projectID)
    })

    const commit = Effect.fn("Project.commit")(function* (input: { store: AbsolutePath; id: ID }) {
      yield* fs.writeFileString(path.join(input.store, "hena"), input.id).pipe(Effect.ignore)
    })

    return Service.of({ list, isFolderless, create, attachFolder, directories, resolve, commit })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, EventV2.node, FSUtil.node, Git.node, Global.node, ProjectDirectories.node],
})

function fromChatRow(input: {
  project: typeof ProjectTable.$inferSelect
  directory: AbsolutePath
}) {
  return ProjectSchema.Chat.make({
    id: input.project.id,
    name: input.project.name!,
    directory: input.directory,
    time: {
      created: DateTime.makeUnsafe(input.project.time_created),
      updated: DateTime.makeUnsafe(input.project.time_updated),
    },
  })
}

const resolveFolder = Effect.fnUntraced(function* (fs: FSUtil.Interface, input: string) {
  if (!path.isAbsolute(input)) return yield* new InvalidFolderError({ folder: input })
  const folder = AbsolutePath.make(yield* fs.resolve(input))
  if (!(yield* fs.isDir(folder))) return yield* new InvalidFolderError({ folder: input })
  return folder
})

function ancestorPaths(directory: AbsolutePath): AbsolutePath[] {
  const parent = AbsolutePath.make(path.dirname(directory))
  return parent === directory ? [directory] : [directory, ...ancestorPaths(parent)]
}
