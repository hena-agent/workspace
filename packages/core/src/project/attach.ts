export * as ProjectAttach from "./attach"

import { Context, DateTime, Effect, Exit, Layer, Schema } from "effect"
import { and, eq } from "drizzle-orm"
import path from "path"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { KeyedMutex } from "../effect/keyed-mutex"
import { EventV2 } from "../event"
import { EventTable } from "../event/sql"
import { FSUtil } from "../fs-util"
import { Global } from "../global"
import { Location } from "../location"
import { AbsolutePath, RelativePath } from "../schema"
import { SessionExecution } from "../session/execution"
import { SessionEvent } from "../session/event"
import { SessionProjector } from "../session/projector"
import { SessionSchema } from "../session/schema"
import { SessionTable } from "../session/sql"
import { EffectFlock } from "../util/effect-flock"
import { WorkspaceV2 } from "../workspace"
import { ProjectSchema } from "./schema"
import { ProjectAttachState } from "./attach-state"
import { ProjectDirectoryTable, ProjectTable } from "./sql"

const ManifestSession = Schema.Struct({
  id: SessionSchema.ID,
  directory: AbsolutePath,
  path: Schema.NullOr(Schema.String),
  workspaceID: Schema.NullOr(WorkspaceV2.ID),
})
const Manifest = Schema.Struct({
  version: Schema.Literal(1),
  id: Schema.String,
  projectID: ProjectSchema.ID,
  source: AbsolutePath,
  target: AbsolutePath,
  targetExisted: Schema.Boolean,
  sessions: Schema.Array(ManifestSession),
})
type Manifest = typeof Manifest.Type
type ManifestSession = typeof ManifestSession.Type

const locks = KeyedMutex.makeUnsafe<ProjectSchema.ID>()
const manifestPrefix = ".hena-attach-"

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("ProjectAttach.NotFoundError", {
  projectID: ProjectSchema.ID,
}) {}

export class AttachError extends Schema.TaggedErrorClass<AttachError>()("ProjectAttach.AttachError", {
  projectID: ProjectSchema.ID,
  reason: Schema.Literals(["not_chat", "invalid_target", "target_not_empty", "target_in_use", "move_failed"]),
}) {}

export type Error = NotFoundError | AttachError

export interface Interface {
  readonly attach: (input: { projectID: ProjectSchema.ID; directory: AbsolutePath }) => Effect.Effect<void, Error>
  readonly recover: (manifest: AbsolutePath) => Effect.Effect<void>
  readonly recoverAll: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@hena/ProjectAttach") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const events = yield* EventV2.Service
    const execution = yield* SessionExecution.Service
    const flock = yield* EffectFlock.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service

    const manifestFile = (projectID: ProjectSchema.ID, source: AbsolutePath) =>
      AbsolutePath.make(path.join(path.dirname(source), `${manifestPrefix}${projectID}.json`))
    const marker = (manifest: Manifest, directory: AbsolutePath) =>
      path.join(directory, `${manifestPrefix}${manifest.id}`)
    const backup = (manifest: Manifest) => AbsolutePath.make(`${manifest.source}.hena-attach-${manifest.id}`)
    const staging = (manifest: Manifest) => AbsolutePath.make(`${manifest.target}.hena-attach-${manifest.id}`)
    const eventID = (manifest: Manifest, session: ManifestSession, direction: "forward" | "rollback") =>
      EventV2.ID.make(`evt_attach_${manifest.id}_${session.id}_${direction}`)

    const writeManifest = Effect.fn("ProjectAttach.writeManifest")(function* (file: AbsolutePath, manifest: Manifest) {
      const temporary = `${file}.${crypto.randomUUID()}.tmp`
      yield* fs.makeDirectory(path.dirname(file), { recursive: true }).pipe(Effect.orDie)
      yield* fs.writeJson(temporary, manifest).pipe(
        Effect.orDie,
        Effect.andThen(fs.rename(temporary, file).pipe(Effect.orDie)),
        Effect.onError(() => fs.remove(temporary, { force: true }).pipe(Effect.ignore)),
      )
    })

    const readManifest = Effect.fn("ProjectAttach.readManifest")(function* (file: AbsolutePath) {
      return yield* Schema.decodeUnknownEffect(Manifest)(yield* fs.readJson(file).pipe(Effect.orDie)).pipe(Effect.orDie)
    })

    const eventExists = (id: EventV2.ID) =>
      db
        .select({ id: EventTable.id })
        .from(EventTable)
        .where(eq(EventTable.id, id))
        .get()
        .pipe(
          Effect.orDie,
          Effect.map((row) => row !== undefined),
        )

    const verifySession = Effect.fn("ProjectAttach.verifySession")(function* (
      manifest: Manifest,
      session: ManifestSession,
      state: "source" | "target",
    ) {
      const current = yield* db
        .select({
          directory: SessionTable.directory,
          path: SessionTable.path,
          workspaceID: SessionTable.workspace_id,
          projectID: SessionTable.project_id,
        })
        .from(SessionTable)
        .where(eq(SessionTable.id, session.id))
        .get()
        .pipe(Effect.orDie)
      const directory =
        state === "source" ? session.directory : AbsolutePath.make(path.join(manifest.target, session.path ?? ""))
      const workspaceID = state === "source" ? session.workspaceID : null
      if (
        !current ||
        current.projectID !== manifest.projectID ||
        current.directory !== directory ||
        current.path !== session.path ||
        current.workspaceID !== workspaceID
      )
        return yield* Effect.die(`Session changed during attach: ${session.id}`)
    })

    const publishMove = Effect.fn("ProjectAttach.publishMove")(function* (
      manifest: Manifest,
      session: ManifestSession,
      direction: "forward" | "rollback",
    ) {
      const id = eventID(manifest, session, direction)
      if (yield* eventExists(id)) return
      const directory =
        direction === "forward" ? AbsolutePath.make(path.join(manifest.target, session.path ?? "")) : session.directory
      yield* events.publish(
        SessionEvent.Moved,
        {
          sessionID: session.id,
          timestamp: yield* DateTime.now,
          location: Location.Ref.make({
            directory,
            workspaceID: direction === "rollback" ? (session.workspaceID ?? undefined) : undefined,
          }),
          subdirectory: session.path ? RelativePath.make(session.path) : undefined,
        },
        {
          id,
          location: Location.Ref.make({ directory }),
          guard: () => verifySession(manifest, session, direction === "forward" ? "source" : "target"),
        },
      )
    })

    const owns = (manifest: Manifest, directory: AbsolutePath) =>
      fs.readFileStringSafe(marker(manifest, directory)).pipe(
        Effect.orDie,
        Effect.map((value) => value === manifest.id),
      )

    const wakeSessions = (manifest: Manifest) =>
      Effect.forEach(manifest.sessions, (session) => execution.wake(session.id), { discard: true }).pipe(
        Effect.catchCause((cause) => Effect.logWarning("Failed to wake Sessions after project attach", { cause })),
      )

    const rollback = Effect.fn("ProjectAttach.rollback")(function* (file: AbsolutePath, manifest: Manifest) {
      const project = yield* db
        .select({ worktree: ProjectTable.worktree, mode: ProjectTable.mode })
        .from(ProjectTable)
        .where(eq(ProjectTable.id, manifest.projectID))
        .get()
        .pipe(Effect.orDie)
      if (project?.mode !== "chat" || project.worktree !== manifest.source)
        return yield* Effect.die("Project changed during attach")

      yield* Effect.forEach(
        manifest.sessions,
        (session) =>
          Effect.gen(function* () {
            if (!(yield* eventExists(eventID(manifest, session, "forward")))) return
            if (yield* eventExists(eventID(manifest, session, "rollback"))) return
            yield* publishMove(manifest, session, "rollback")
          }),
        { discard: true },
      )

      const stagingExists = yield* fs.exists(staging(manifest)).pipe(Effect.orDie)
      const targetExists = yield* fs.exists(manifest.target).pipe(Effect.orDie)
      const targetOwned = targetExists && (yield* owns(manifest, manifest.target))
      const backupExists = yield* fs.exists(backup(manifest)).pipe(Effect.orDie)
      const sourceExists = yield* fs.exists(manifest.source).pipe(Effect.orDie)

      if (backupExists) {
        if (!(yield* owns(manifest, backup(manifest))) || sourceExists)
          return yield* Effect.die("Attach source ownership is ambiguous")
        yield* fs.rename(backup(manifest), manifest.source).pipe(Effect.orDie)
      } else if (!sourceExists) {
        return yield* Effect.die("Attach source is unavailable")
      } else if (!(yield* owns(manifest, manifest.source)) && (stagingExists || targetOwned)) {
        return yield* Effect.die("Attach source ownership is ambiguous")
      }

      if (stagingExists) {
        if (!(yield* owns(manifest, staging(manifest)))) return yield* Effect.die("Attach staging ownership is ambiguous")
        yield* fs.remove(staging(manifest), { recursive: true, force: true }).pipe(Effect.orDie)
      }
      if (targetExists) {
        if (targetOwned) {
          const recovered = AbsolutePath.make(`${manifest.target}.hena-recovered-${manifest.id}`)
          if (yield* fs.exists(recovered).pipe(Effect.orDie))
            return yield* Effect.die("Recovered attach target already exists")
          yield* fs.rename(manifest.target, recovered).pipe(Effect.orDie)
        } else {
          const untouched =
            manifest.targetExisted &&
            (yield* fs.isDir(manifest.target)) &&
            (yield* fs.readDirectory(manifest.target).pipe(Effect.orDie)).length === 0
          if (!untouched) return yield* Effect.die("Attach target ownership is ambiguous")
        }
      }
      if (manifest.targetExisted && !(yield* fs.exists(manifest.target).pipe(Effect.orDie)))
        yield* fs.makeDirectory(manifest.target, { recursive: true }).pipe(Effect.orDie)
      yield* fs.remove(marker(manifest, manifest.source), { force: true }).pipe(Effect.orDie)
      yield* fs.remove(file, { force: true }).pipe(Effect.orDie)
      ProjectAttachState.unblock(manifest.projectID)
      yield* wakeSessions(manifest)
    })

    const finishCommitted = Effect.fn("ProjectAttach.finishCommitted")(function* (
      file: AbsolutePath,
      manifest: Manifest,
    ) {
      const project = yield* db
        .select({ worktree: ProjectTable.worktree, mode: ProjectTable.mode })
        .from(ProjectTable)
        .where(eq(ProjectTable.id, manifest.projectID))
        .get()
        .pipe(Effect.orDie)
      if (project?.mode !== "workspace" || project.worktree !== manifest.target)
        return yield* Effect.die("Committed attach Project state is unavailable")
      if (!(yield* fs.isDir(manifest.target))) return yield* Effect.die("Committed attach target is unavailable")

      if (yield* fs.exists(backup(manifest)).pipe(Effect.orDie)) {
        if (!(yield* owns(manifest, backup(manifest))) || !(yield* owns(manifest, manifest.target)))
          return yield* Effect.die("Attach cleanup ownership is ambiguous")
        yield* fs.remove(backup(manifest), { recursive: true, force: true }).pipe(Effect.orDie)
      } else if (yield* fs.exists(manifest.source).pipe(Effect.orDie)) {
        if (!(yield* owns(manifest, manifest.source)) || !(yield* owns(manifest, manifest.target)))
          return yield* Effect.die("Attach cleanup ownership is ambiguous")
        yield* fs.remove(manifest.source, { recursive: true, force: true }).pipe(Effect.orDie)
      }
      if (yield* fs.exists(staging(manifest)).pipe(Effect.orDie)) {
        if (!(yield* owns(manifest, staging(manifest)))) return yield* Effect.die("Attach staging ownership is ambiguous")
        yield* fs.remove(staging(manifest), { recursive: true, force: true }).pipe(Effect.orDie)
      }
      yield* fs.remove(marker(manifest, manifest.target), { force: true }).pipe(Effect.orDie)
      yield* fs.remove(file, { force: true }).pipe(Effect.orDie)
      ProjectAttachState.unblock(manifest.projectID)
      yield* wakeSessions(manifest)
    })

    const orDieLock = <A, E, R>(effect: Effect.Effect<A, E | EffectFlock.LockError, R>): Effect.Effect<A, E, R> =>
      effect.pipe(
        Effect.catch((error) =>
          error instanceof EffectFlock.LockTimeoutError || error instanceof EffectFlock.LockCompromisedError
            ? Effect.die(error)
            : Effect.fail(error as E),
        ),
      )

    const withProjectLock = <A, E, R>(projectID: ProjectSchema.ID, effect: Effect.Effect<A, E, R>) =>
      locks.withLock(projectID)(orDieLock(flock.withLock(effect, `project-attach:${projectID}`)))
    const withPathLocks = <A, E, R>(paths: AbsolutePath[], effect: Effect.Effect<A, E, R>) =>
      Array.from(new Set(paths))
        .sort()
        .reduceRight((body, directory) => orDieLock(flock.withLock(body, `project-attach-path:${directory}`)), effect)

    const recoverUnlocked = Effect.fn("ProjectAttach.recoverUnlocked")(function* (file: AbsolutePath) {
      if (!(yield* fs.exists(file).pipe(Effect.orDie))) return
      const manifest = yield* readManifest(file)
      ProjectAttachState.block(manifest.projectID)
      const project = yield* db
        .select({ worktree: ProjectTable.worktree, mode: ProjectTable.mode })
        .from(ProjectTable)
        .where(eq(ProjectTable.id, manifest.projectID))
        .get()
        .pipe(Effect.orDie)
      if (project?.mode === "workspace" && project.worktree === manifest.target)
        return yield* finishCommitted(file, manifest)
      return yield* rollback(file, manifest)
    })

    const recover: Interface["recover"] = Effect.fn("ProjectAttach.recover")(function* (file) {
      if (!(yield* fs.exists(file).pipe(Effect.orDie))) return
      const manifest = yield* readManifest(file)
      yield* withProjectLock(
        manifest.projectID,
        withPathLocks([manifest.source, manifest.target], recoverUnlocked(file)),
      )
    })

    const execute = Effect.fn("ProjectAttach.execute")(function* (file: AbsolutePath, manifest: Manifest) {
      yield* Effect.forEach(manifest.sessions, (session) => execution.interrupt(session.id), { discard: true })
      yield* fs.writeFileString(marker(manifest, manifest.source), manifest.id).pipe(Effect.orDie)
      yield* Effect.tryPromise(async () => {
        const { cp } = await import("fs/promises")
        await cp(manifest.source, staging(manifest), {
          recursive: true,
          errorOnExist: true,
          force: false,
          preserveTimestamps: true,
          verbatimSymlinks: true,
        })
      })
      yield* fs.rename(manifest.source, backup(manifest)).pipe(Effect.orDie)

      if (yield* fs.exists(manifest.target).pipe(Effect.orDie)) {
        if (!(yield* fs.isDir(manifest.target))) return yield* Effect.die("Attach target is no longer a directory")
        if ((yield* fs.readDirectory(manifest.target).pipe(Effect.orDie)).length > 0)
          return yield* Effect.die("Attach target is no longer empty")
        yield* fs.remove(manifest.target, { recursive: true }).pipe(Effect.orDie)
      }
      yield* fs.rename(staging(manifest), manifest.target).pipe(Effect.orDie)
      yield* Effect.forEach(manifest.sessions, (session) => publishMove(manifest, session, "forward"), {
        discard: true,
      })

      yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const project = yield* tx
              .select({ worktree: ProjectTable.worktree, mode: ProjectTable.mode })
              .from(ProjectTable)
              .where(eq(ProjectTable.id, manifest.projectID))
              .get()
            if (project?.mode !== "chat" || project.worktree !== manifest.source)
              return yield* Effect.die("Project changed during attach")
            const directories = yield* tx
              .select({ directory: ProjectDirectoryTable.directory })
              .from(ProjectDirectoryTable)
              .where(eq(ProjectDirectoryTable.project_id, manifest.projectID))
              .all()
            if (directories.length > 0) return yield* Effect.die("Chat Project gained directories during attach")
            const sessions = yield* tx
              .select({
                id: SessionTable.id,
                directory: SessionTable.directory,
                path: SessionTable.path,
                workspaceID: SessionTable.workspace_id,
              })
              .from(SessionTable)
              .where(eq(SessionTable.project_id, manifest.projectID))
              .all()
            if (
              sessions.length !== manifest.sessions.length ||
              sessions.some(
                (session) =>
                  !manifest.sessions.some(
                    (snapshot) =>
                      snapshot.id === session.id &&
                      session.directory === path.join(manifest.target, snapshot.path ?? "") &&
                      session.path === snapshot.path &&
                      session.workspaceID === null,
                  ),
              )
            )
              return yield* Effect.die("Project sessions changed during attach")
            yield* tx
              .update(ProjectTable)
              .set({ worktree: manifest.target, mode: "workspace", time_updated: Date.now() })
              .where(eq(ProjectTable.id, manifest.projectID))
              .run()
            yield* tx
              .insert(ProjectDirectoryTable)
              .values({ project_id: manifest.projectID, directory: manifest.target, strategy: "attach" })
              .run()
          }),
        )
        .pipe(Effect.orDie)

      yield* finishCommitted(file, manifest)
    })

    const attach: Interface["attach"] = Effect.fn("ProjectAttach.attach")(function* (input) {
      return yield* withProjectLock(
        input.projectID,
        Effect.uninterruptible(
          Effect.gen(function* () {
            const initial = yield* db
              .select()
              .from(ProjectTable)
              .where(eq(ProjectTable.id, input.projectID))
              .get()
              .pipe(Effect.orDie)
            if (!initial) return yield* new NotFoundError({ projectID: input.projectID })
            const file =
              initial.mode === "chat"
                ? manifestFile(input.projectID, initial.worktree)
                : AbsolutePath.make(path.join(global.data, "projects", `${manifestPrefix}${input.projectID}.json`))
            if (yield* fs.exists(file).pipe(Effect.orDie)) {
              const pending = yield* readManifest(file)
              yield* withPathLocks([pending.source, pending.target], recoverUnlocked(file))
            }

            const project = yield* db
              .select()
              .from(ProjectTable)
              .where(eq(ProjectTable.id, input.projectID))
              .get()
              .pipe(Effect.orDie)
            if (!project) return yield* new NotFoundError({ projectID: input.projectID })

            const requestedTarget = path.resolve(input.directory)
            const requestedTargetExists = yield* fs.exists(requestedTarget).pipe(Effect.orDie)
            const target = AbsolutePath.make(
              requestedTargetExists
                ? yield* fs.resolve(requestedTarget)
                : path.join(yield* fs.resolve(path.dirname(requestedTarget)), path.basename(requestedTarget)),
            )
            const source = AbsolutePath.make(yield* fs.resolve(project.worktree))
            if (requestedTargetExists && target !== requestedTarget)
              return yield* new AttachError({ projectID: input.projectID, reason: "invalid_target" })
            if (project.mode === "workspace" && source === target) return
            if (project.mode !== "chat")
              return yield* new AttachError({ projectID: input.projectID, reason: "not_chat" })
            const relative = path.relative(source, target)
            if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative)))
              return yield* new AttachError({ projectID: input.projectID, reason: "invalid_target" })
            if (!(yield* fs.isDir(source)))
              return yield* new AttachError({ projectID: input.projectID, reason: "move_failed" })

            const targetExists = yield* fs.exists(target).pipe(Effect.orDie)
            if (targetExists) {
              if (!(yield* fs.isDir(target)))
                return yield* new AttachError({ projectID: input.projectID, reason: "invalid_target" })
              if ((yield* fs.readDirectory(target).pipe(Effect.orDie)).length > 0)
                return yield* new AttachError({ projectID: input.projectID, reason: "target_not_empty" })
            }
            const directories = yield* db
              .select({ directory: ProjectDirectoryTable.directory })
              .from(ProjectDirectoryTable)
              .where(eq(ProjectDirectoryTable.project_id, project.id))
              .all()
              .pipe(Effect.orDie)
            if (directories.length > 0)
              return yield* new AttachError({ projectID: input.projectID, reason: "move_failed" })

            const sessions = yield* db
              .select({
                id: SessionTable.id,
                directory: SessionTable.directory,
                path: SessionTable.path,
                workspaceID: SessionTable.workspace_id,
              })
              .from(SessionTable)
              .where(eq(SessionTable.project_id, project.id))
              .all()
              .pipe(Effect.orDie)
            const id = crypto.randomUUID()
            const manifest = Manifest.make({
              version: 1,
              id,
              projectID: project.id,
              source,
              target,
              targetExisted: targetExists,
              sessions: sessions.map((session) => ({
                id: session.id,
                directory: AbsolutePath.make(session.directory),
                path: session.path,
                workspaceID: session.workspaceID,
              })),
            })
            yield* fs.makeDirectory(path.dirname(target), { recursive: true }).pipe(Effect.orDie)
            return yield* withPathLocks(
              [source, target],
              Effect.gen(function* () {
                const owner = yield* db
                  .select({ projectID: ProjectDirectoryTable.project_id })
                  .from(ProjectDirectoryTable)
                  .where(
                    and(
                      eq(ProjectDirectoryTable.directory, target),
                      eq(ProjectDirectoryTable.strategy, "attach"),
                    ),
                  )
                  .get()
                  .pipe(Effect.orDie)
                if (owner)
                  return yield* new AttachError({ projectID: project.id, reason: "target_in_use" })

                ProjectAttachState.block(project.id)
                yield* writeManifest(file, manifest).pipe(
                  Effect.onError(() => Effect.sync(() => ProjectAttachState.unblock(project.id))),
                )

                const result = yield* Effect.exit(execute(file, manifest))
                if (Exit.isSuccess(result)) return
                const recovery = yield* Effect.exit(recoverUnlocked(file))
                if (Exit.isFailure(recovery)) {
                  yield* Effect.logError("Project attach rollback failed", {
                    projectID: project.id,
                    cause: result.cause,
                    recoveryCause: recovery.cause,
                  })
                  return yield* new AttachError({ projectID: project.id, reason: "move_failed" })
                }
                const attached = yield* db
                  .select({ worktree: ProjectTable.worktree, mode: ProjectTable.mode })
                  .from(ProjectTable)
                  .where(eq(ProjectTable.id, project.id))
                  .get()
                  .pipe(Effect.orDie)
                if (attached?.mode === "workspace" && attached.worktree === target) return
                return yield* new AttachError({ projectID: project.id, reason: "move_failed" })
              }),
            )
          }),
        ),
      )
    })

    const recoverAll = fs.makeDirectory(path.join(global.data, "projects"), { recursive: true }).pipe(
      Effect.orDie,
      Effect.andThen(fs.readDirectory(path.join(global.data, "projects")).pipe(Effect.orDie)),
      Effect.flatMap((entries) =>
        Effect.forEach(
          entries.filter((entry) => entry.startsWith(manifestPrefix) && entry.endsWith(".json")),
          (entry) =>
            recover(AbsolutePath.make(path.join(global.data, "projects", entry))).pipe(
              Effect.catchCause((cause) => Effect.logWarning("Project attach recovery failed", { entry, cause })),
            ),
          { discard: true },
        ),
      ),
    )

    return Service.of({ attach, recover, recoverAll })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer: layer.pipe(Layer.orDie),
  deps: [Database.node, EventV2.node, SessionExecution.node, FSUtil.node, EffectFlock.node, Global.node],
})

export class RecoveryReady extends Context.Service<RecoveryReady, true>()("@hena/ProjectAttach/RecoveryReady") {}

export const recoveryNode = makeGlobalNode({
  service: RecoveryReady,
  layer: Layer.effect(
    RecoveryReady,
    Effect.gen(function* () {
      yield* (yield* Service).recoverAll
      return true as const
    }),
  ),
  deps: [node, SessionProjector.node],
})
