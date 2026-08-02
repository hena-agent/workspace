export * as ProjectV2 from "./project"
export * as Project from "./project"

import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import { Context, DateTime, Effect, Exit, Layer, Schema, Scope } from "effect"
import path from "path"
import { Database } from "./database/database"
import { EventV2 } from "./event"
import { makeGlobalNode } from "./effect/app-node"
import { FSUtil } from "./fs-util"
import { Git } from "./git"
import { Global } from "./global"
import { ProjectDirectories } from "./project/directories"
import { ProjectSchema } from "./project/schema"
import { ProjectAttachmentTable, ProjectDirectoryTable, ProjectTable } from "./project/sql"
import { AbsolutePath, RelativePath } from "./schema"
import { SessionSchema } from "./session/schema"
import { SessionActivity } from "./session/activity"
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

export class AttachmentConflictError extends Schema.TaggedErrorClass<AttachmentConflictError>()(
  "Project.AttachmentConflictError",
  { projectID: ID },
) {}

export class SessionsActiveError extends Schema.TaggedErrorClass<SessionsActiveError>()("Project.SessionsActiveError", {
  projectID: ID,
  sessionIDs: Schema.Array(SessionSchema.ID),
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
  readonly listAttachments: () => Effect.Effect<ReadonlyArray<ProjectSchema.AttachmentReceipt>>
  readonly isFolderless: (projectID: ID) => Effect.Effect<boolean>
  readonly create: (input: { readonly name: string }) => Effect.Effect<ProjectSchema.Chat, InvalidNameError>
  readonly attachFolder: (input: {
    readonly projectID: ID
    readonly folder: string
    readonly initiatingSessionID?: SessionSchema.ID
  }) => Effect.Effect<
    ProjectSchema.Attachment,
    NotFoundError | InvalidFolderError | AttachmentConflictError | SessionsActiveError
  >
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
    const activity = yield* SessionActivity.Service
    const scope = yield* Scope.Scope

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

    const listAttachments = Effect.fn("Project.listAttachments")(function* () {
      return yield* db
        .select({ projectID: ProjectAttachmentTable.source_project_id, attachment: ProjectAttachmentTable.attachment })
        .from(ProjectAttachmentTable)
        .all()
        .pipe(Effect.orDie)
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
                yield* tx.insert(ProjectDirectoryTable).values({ project_id: id, directory, type: "main" }).run()
                return project
              }),
            )
            .pipe(Effect.orDie)
          const chat = fromChatRow({ project: row, directory })
          yield* events
            .publish(ProjectSchema.Event.ChatCreated, chat)
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logError("Project notification listener failed", cause).pipe(
                  Effect.annotateLogs({ projectID: chat.id, eventType: ProjectSchema.Event.ChatCreated.type }),
                ),
              ),
            )
          return chat
        }).pipe(
          Effect.onExit((exit) =>
            Exit.isFailure(exit)
              ? fs.remove(scratch, { recursive: true, force: true }).pipe(Effect.ignore)
              : Effect.void,
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

    const cleanup = Effect.fnUntraced(function* (sourceProjectID: ID, scratch: AbsolutePath) {
      if (!(yield* managedScratch(fs, AbsolutePath.make(global.data), sourceProjectID, scratch))) {
        yield* Effect.logWarning("Skipping unmanaged project scratch cleanup", { sourceProjectID, scratch })
        return true
      }
      if (containsPath(scratch, process.cwd())) return false
      const operation = yield* db
        .select({ relocations: ProjectAttachmentTable.relocations })
        .from(ProjectAttachmentTable)
        .where(eq(ProjectAttachmentTable.source_project_id, sourceProjectID))
        .get()
        .pipe(Effect.orDie)
      const active = yield* activity.active
      if (operation?.relocations.some((item) => active.has(SessionSchema.ID.make(item.sessionID)))) return false
      const removed = yield* fs.remove(scratch, { recursive: true, force: true }).pipe(Effect.exit)
      if (Exit.isFailure(removed)) return false
      yield* db
        .update(ProjectAttachmentTable)
        .set({ cleanup_status: "complete", time_updated: Date.now() })
        .where(eq(ProjectAttachmentTable.source_project_id, sourceProjectID))
        .run()
        .pipe(Effect.orDie)
      return true
    })

    const cleaning = new Set<ID>()
    const scheduleCleanup = Effect.fnUntraced(function* (sourceProjectID: ID, scratch: AbsolutePath) {
      if (yield* cleanup(sourceProjectID, scratch)) return
      if (cleaning.has(sourceProjectID)) return
      cleaning.add(sourceProjectID)
      function run(): Effect.Effect<void> {
        return Effect.sleep("1 second").pipe(
          Effect.andThen(cleanup(sourceProjectID, scratch)),
          Effect.flatMap((complete) =>
            complete ? Effect.void : Effect.suspend(run),
          ),
        )
      }
      yield* run().pipe(Effect.ensuring(Effect.sync(() => cleaning.delete(sourceProjectID))), Effect.forkIn(scope))
    })

    const retryCleanup = Effect.fnUntraced(function* () {
      const rows = yield* db
        .select({
          sourceProjectID: ProjectAttachmentTable.source_project_id,
          scratch: ProjectAttachmentTable.source_scratch,
        })
        .from(ProjectAttachmentTable)
        .where(eq(ProjectAttachmentTable.cleanup_status, "pending"))
        .all()
        .pipe(Effect.orDie)
      yield* Effect.forEach(rows, (row) => scheduleCleanup(row.sourceProjectID, row.scratch), { discard: true })
    })

    yield* retryCleanup()

    const attachFolder = Effect.fn("Project.attachFolder")(function* (input) {
      const requestedFolder = normalizeRequestedFolder(input.folder)
      const timestamp = yield* DateTime.now
      const result = yield* Effect.scoped(
        db.transaction(
          (tx) =>
            Effect.gen(function* () {
              const receipt = yield* tx
                .select()
                .from(ProjectAttachmentTable)
                .where(eq(ProjectAttachmentTable.source_project_id, input.projectID))
                .get()
              if (receipt) {
                if (receipt.requested_folder !== requestedFolder)
                  return yield* new AttachmentConflictError({ projectID: input.projectID })
                return { attachment: receipt.attachment, scratch: receipt.source_scratch, events: [] }
              }

              const selected = yield* resolveFolder(fs, input.folder)
              const destination = yield* resolve(selected)
              if (destination.id === input.projectID) return yield* new InvalidFolderError({ folder: input.folder })
              if (!destination.vcs && destination.id !== ID.global)
                return yield* new InvalidFolderError({ folder: input.folder })
              const directory = destination.vcs ? destination.directory : selected
              const destinationProject = yield* tx
                .select({ worktree: ProjectTable.worktree, sandboxes: ProjectTable.sandboxes })
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
              if (!source) return yield* new NotFoundError({ projectID: input.projectID })

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
              const projectWorktree = destinationProject?.worktree ?? destination.directory
              const sandboxes = [
                ...(destinationProject?.sandboxes ?? []),
                ...(directory === projectWorktree ? [] : [directory]),
              ].filter((item, index, values) => values.indexOf(item) === index)
              if (destinationProject && sandboxes.length !== destinationProject.sandboxes.length) {
                yield* tx.update(ProjectTable).set({ sandboxes }).where(eq(ProjectTable.id, destination.id)).run()
              }
              yield* tx
                .insert(ProjectDirectoryTable)
                .values({
                  project_id: destination.id,
                  directory,
                  type: directory === projectWorktree ? "main" : "git_worktree",
                })
                .onConflictDoNothing()
                .run()

              const sessions = yield* tx
                .select()
                .from(SessionTable)
                .where(eq(SessionTable.project_id, input.projectID))
                .all()
              const sessionIDs = sessions.map((session) => SessionSchema.ID.make(session.id))
              const claim = yield* activity
                .claimInactive(sessionIDs, input.initiatingSessionID)
                .pipe(
                  Effect.mapError((sessionIDs) => new SessionsActiveError({ projectID: input.projectID, sessionIDs })),
                )
              yield* Effect.addFinalizer(() => claim.release)
              const movedEvents = yield* Effect.forEach(sessions, (session) => {
                const relative = path.relative(source.directory, session.directory)
                const subpath = (
                  relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ? "" : relative
                ).replaceAll("\\", "/")
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
              })
              const attachment = ProjectSchema.Attachment.make({
                project: { id: destination.id, directory, vcs: destination.vcs?.type },
                sessionIDs: sessions.map((session) => SessionSchema.ID.make(session.id)),
              })
              const repository = destination.vcs ? yield* git.repo.discover(destination.directory) : undefined
              const head = repository ? yield* git.history.head(repository) : undefined
              const branch = repository ? yield* git.history.branch(repository) : undefined
              const relocations = sessions.map((session) => {
                const relative = path.relative(source.directory, session.directory)
                const subpath = (
                  relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ? "" : relative
                ).replaceAll("\\", "/")
                return {
                  sessionID: session.id,
                  from: session.directory,
                  to: path.resolve(directory, subpath),
                  ...(subpath ? { subpath } : {}),
                }
              })
              yield* tx
                .insert(ProjectAttachmentTable)
                .values({
                  source_project_id: input.projectID,
                  requested_folder: requestedFolder,
                  source_scratch: source.directory,
                  attachment,
                  relocations,
                  checkout: {
                    projectID: destination.id,
                    directory,
                    ...(destination.vcs ? { vcs: destination.vcs.type } : {}),
                    ...(head ? { head } : {}),
                    ...(branch ? { branch } : {}),
                  },
                  cleanup_status: "pending",
                })
                .run()
              yield* tx.delete(ProjectTable).where(eq(ProjectTable.id, input.projectID)).run()
              return {
                attachment,
                scratch: source.directory,
                events: movedEvents,
              }
            }),
          { behavior: "immediate" },
        ),
      ).pipe(
        Effect.catchTags({
          EffectDrizzleQueryError: Effect.die,
          SqlError: Effect.die,
        }),
        Effect.tap((result) => Effect.forEach(result.events, events.broadcast, { discard: true })),
        Effect.uninterruptible,
      )
      yield* scheduleCleanup(input.projectID, result.scratch)
      yield* events
        .publish(ProjectSchema.Event.Attached, {
          projectID: input.projectID,
          attachment: result.attachment,
          timestamp,
        })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logError("Project notification listener failed", cause).pipe(
              Effect.annotateLogs({ projectID: input.projectID, eventType: ProjectSchema.Event.Attached.type }),
            ),
          ),
        )
      return result.attachment
    })

    const directories = Effect.fn("Project.directories")(function* (input: DirectoriesInput) {
      return yield* projectDirectories.list(input.projectID)
    })

    const commit = Effect.fn("Project.commit")(function* (input: { store: AbsolutePath; id: ID }) {
      yield* fs.writeFileString(path.join(input.store, "hena"), input.id).pipe(Effect.ignore)
    })

    return Service.of({ list, listAttachments, isFolderless, create, attachFolder, directories, resolve, commit })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [
    Database.node,
    EventV2.node,
    FSUtil.node,
    Git.node,
    Global.node,
    ProjectDirectories.node,
    SessionActivity.node,
  ],
})

function fromChatRow(input: { project: typeof ProjectTable.$inferSelect; directory: AbsolutePath }) {
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
  if (!(yield* fs.existsSafe(input))) return yield* new InvalidFolderError({ folder: input })
  const folder = AbsolutePath.make(yield* fs.resolve(input))
  if (!(yield* fs.isDir(folder))) return yield* new InvalidFolderError({ folder: input })
  return folder
})

function ancestorPaths(directory: AbsolutePath): AbsolutePath[] {
  const parent = AbsolutePath.make(path.dirname(directory))
  return parent === directory ? [directory] : [directory, ...ancestorPaths(parent)]
}

function normalizeRequestedFolder(input: string) {
  const normalized = path.win32.isAbsolute(input) ? path.win32.normalize(input) : path.resolve(input)
  return normalized.replaceAll("\\", "/").replace(/\/$/, "") || "/"
}

function containsPath(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

const managedScratch = Effect.fnUntraced(function* (
  fs: FSUtil.Interface,
  data: AbsolutePath,
  sourceProjectID: ID,
  scratch: AbsolutePath,
) {
  const root = AbsolutePath.make(yield* fs.resolve(path.join(data, "projects")))
  const expected = AbsolutePath.make(path.join(root, sourceProjectID))
  if (scratch !== expected) return false
  if (!(yield* fs.existsSafe(scratch))) return true
  return (yield* fs.resolve(scratch)) === expected
})
