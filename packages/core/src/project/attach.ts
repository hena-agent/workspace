export * as ProjectAttach from "./attach"

import { Cause, Context, DateTime, Effect, Exit, Layer, Schema } from "effect"
import { desc, eq, notInArray } from "drizzle-orm"
import path from "path"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { KeyedMutex } from "../effect/keyed-mutex"
import { EventV2 } from "../event"
import { EventTable } from "../event/sql"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { SessionExecution } from "../session/execution"
import { SessionEvent } from "../session/event"
import { SessionProjector } from "../session/projector"
import { SessionTable } from "../session/sql"
import { AbsolutePath, RelativePath } from "../schema"
import { EffectFlock } from "../util/effect-flock"
import { ProjectSchema } from "./schema"
import {
  ProjectAttachDirectoryTable,
  ProjectAttachOperationTable,
  ProjectAttachSessionTable,
  ProjectDirectoryTable,
  ProjectTable,
} from "./sql"

const finishedPhases: ProjectSchema.AttachPhase[] = ["completed", "rolled_back"]
const startupRecoveryPhases: ProjectSchema.AttachPhase[] = ["completed", "rolled_back", "recovery_required"]
const committedPhases: ProjectSchema.AttachPhase[] = ["committed", "cleanup_pending", "completed"]
const locks = KeyedMutex.makeUnsafe<ProjectSchema.ID>()

type OperationRow = typeof ProjectAttachOperationTable.$inferSelect
type SessionRow = typeof ProjectAttachSessionTable.$inferSelect
type DirectorySnapshot = Pick<
  typeof ProjectAttachDirectoryTable.$inferSelect,
  "directory" | "type" | "strategy" | "time_created"
>

function sameDirectories(expected: DirectorySnapshot[], current: DirectorySnapshot[]) {
  return (
    expected.length === current.length &&
    expected.every((directory) =>
      current.some(
        (item) =>
          item.directory === directory.directory &&
          item.type === directory.type &&
          item.strategy === directory.strategy &&
          item.time_created === directory.time_created,
      ),
    )
  )
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("ProjectAttach.NotFoundError", {
  projectID: ProjectSchema.ID,
}) {}

export class AttachError extends Schema.TaggedErrorClass<AttachError>()("ProjectAttach.AttachError", {
  projectID: ProjectSchema.ID,
  operationID: Schema.optional(ProjectSchema.AttachOperationID),
  reason: Schema.Literals(["not_chat", "invalid_target", "target_not_empty", "operation_failed"]),
}) {}

export class RecoveryRequiredError extends Schema.TaggedErrorClass<RecoveryRequiredError>()(
  "ProjectAttach.RecoveryRequiredError",
  {
    projectID: ProjectSchema.ID,
    operationID: ProjectSchema.AttachOperationID,
  },
) {}

export type Error = NotFoundError | AttachError | RecoveryRequiredError

export interface Interface {
  readonly attach: (input: {
    projectID: ProjectSchema.ID
    directory: AbsolutePath
  }) => Effect.Effect<ProjectSchema.AttachOperation, Error>
  readonly get: (projectID: ProjectSchema.ID) => Effect.Effect<ProjectSchema.AttachOperation | undefined, NotFoundError>
  readonly recover: (
    projectID: ProjectSchema.ID,
  ) => Effect.Effect<ProjectSchema.AttachOperation | undefined, NotFoundError | RecoveryRequiredError>
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

    const operationInfo = (operation: OperationRow) =>
      ProjectSchema.AttachOperation.make({
        id: operation.id,
        projectID: operation.project_id,
        source: operation.source,
        target: operation.target,
        phase: operation.phase,
        error: operation.error ?? undefined,
        time: { created: operation.time_created, updated: operation.time_updated },
      })

    const latest = (projectID: ProjectSchema.ID) =>
      db
        .select()
        .from(ProjectAttachOperationTable)
        .where(eq(ProjectAttachOperationTable.project_id, projectID))
        .orderBy(desc(ProjectAttachOperationTable.time_updated))
        .limit(1)
        .get()
        .pipe(Effect.orDie)

    const requireProject = Effect.fn("ProjectAttach.requireProject")(function* (projectID: ProjectSchema.ID) {
      const project = yield* db
        .select()
        .from(ProjectTable)
        .where(eq(ProjectTable.id, projectID))
        .get()
        .pipe(Effect.orDie)
      if (!project) return yield* new NotFoundError({ projectID })
      return project
    })

    const updatePhase = (
      operationID: ProjectSchema.AttachOperationID,
      phase: ProjectSchema.AttachPhase,
      error?: string,
    ) =>
      db
        .update(ProjectAttachOperationTable)
        .set({ phase, error, time_updated: Date.now() })
        .where(eq(ProjectAttachOperationTable.id, operationID))
        .run()
        .pipe(Effect.orDie)

    const sessionRows = (operationID: ProjectSchema.AttachOperationID) =>
      db
        .select()
        .from(ProjectAttachSessionTable)
        .where(eq(ProjectAttachSessionTable.operation_id, operationID))
        .all()
        .pipe(Effect.orDie)

    const eventExists = (eventID: EventV2.ID) =>
      db
        .select({ id: EventTable.id })
        .from(EventTable)
        .where(eq(EventTable.id, eventID))
        .get()
        .pipe(
          Effect.orDie,
          Effect.map((row) => row !== undefined),
        )

    const verifySession = Effect.fn("ProjectAttach.verifySession")(function* (
      operation: OperationRow,
      session: SessionRow,
      direction: "forward" | "rollback",
    ) {
      const current = yield* db
        .select({
          directory: SessionTable.directory,
          path: SessionTable.path,
          workspaceID: SessionTable.workspace_id,
        })
        .from(SessionTable)
        .where(eq(SessionTable.id, session.session_id))
        .get()
        .pipe(Effect.orDie)
      const directory =
        direction === "forward" ? AbsolutePath.make(path.join(operation.target, session.path ?? "")) : session.directory
      const workspaceID = direction === "forward" ? null : session.workspace_id
      if (
        !current ||
        current.directory !== directory ||
        current.path !== session.path ||
        current.workspaceID !== workspaceID
      )
        return yield* Effect.die(`Session changed during attach: ${session.session_id}`)
    })

    const isCommitted = Effect.fn("ProjectAttach.isCommitted")(function* (operation: OperationRow) {
      if (committedPhases.includes(operation.phase)) return true
      const project = yield* db
        .select({ worktree: ProjectTable.worktree, mode: ProjectTable.mode })
        .from(ProjectTable)
        .where(eq(ProjectTable.id, operation.project_id))
        .get()
        .pipe(Effect.orDie)
      return project?.mode === "workspace" && project.worktree === operation.target
    })

    const publishMove = Effect.fn("ProjectAttach.publishMove")(function* (
      operation: OperationRow,
      session: SessionRow,
      direction: "forward" | "rollback",
    ) {
      const eventID = direction === "forward" ? session.forward_event_id : session.rollback_event_id
      if (yield* eventExists(eventID)) return
      const directory =
        direction === "forward" ? AbsolutePath.make(path.join(operation.target, session.path ?? "")) : session.directory
      yield* events.publish(
        SessionEvent.Moved,
        {
          sessionID: session.session_id,
          timestamp: yield* DateTime.now,
          location: Location.Ref.make({
            directory,
            workspaceID: direction === "rollback" ? (session.workspace_id ?? undefined) : undefined,
          }),
          subdirectory: session.path ? RelativePath.make(session.path) : undefined,
        },
        {
          id: eventID,
          location: Location.Ref.make({ directory }),
          guard: () => verifySession(operation, session, direction === "forward" ? "rollback" : "forward"),
        },
      )
    })

    const markerPath = (operation: OperationRow, directory: AbsolutePath) =>
      path.join(directory, `.hena-attach-${operation.id}`)

    const ownsTarget = Effect.fn("ProjectAttach.ownsTarget")(function* (operation: OperationRow) {
      return (yield* fs.readFileStringSafe(markerPath(operation, operation.target))) === operation.id
    })

    const wakeSessions = (sessions: SessionRow[]) =>
      Effect.forEach(sessions, (session) => execution.wake(session.session_id), { discard: true }).pipe(
        Effect.catchCause((cause) => Effect.logWarning("Failed to wake Sessions after project attach", { cause })),
      )

    const markRecoveryRequired = (operation: OperationRow, error: string) =>
      updatePhase(operation.id, "recovery_required", error).pipe(Effect.ignore)

    const restoreFilesystem = Effect.fn("ProjectAttach.restoreFilesystem")(function* (operation: OperationRow) {
      if (!(yield* fs.isDir(operation.source))) return yield* Effect.die("Attach source is unavailable")

      if (yield* fs.exists(operation.staging))
        yield* fs.remove(operation.staging, { recursive: true, force: true }).pipe(Effect.orDie)

      if (yield* fs.exists(operation.target)) {
        if (yield* ownsTarget(operation)) {
          yield* fs.remove(operation.target, { recursive: true, force: true }).pipe(Effect.orDie)
        } else {
          const untouchedTarget =
            operation.target_existed &&
            (yield* fs.isDir(operation.target)) &&
            (yield* fs.readDirectory(operation.target).pipe(Effect.orDie)).length === 0
          if (!untouchedTarget) return yield* Effect.die("Attach target ownership is ambiguous")
        }
      }
      if (operation.target_existed && !(yield* fs.exists(operation.target)))
        yield* fs.makeDirectory(operation.target, { recursive: true }).pipe(Effect.orDie)
      yield* fs.remove(markerPath(operation, operation.source), { force: true }).pipe(Effect.orDie)
    })

    const verifyRollbackState = Effect.fn("ProjectAttach.verifyRollbackState")(function* (operation: OperationRow) {
      const project = yield* db
        .select({ worktree: ProjectTable.worktree, mode: ProjectTable.mode })
        .from(ProjectTable)
        .where(eq(ProjectTable.id, operation.project_id))
        .get()
        .pipe(Effect.orDie)
      if (project?.mode !== "chat" || project.worktree !== operation.source)
        return yield* Effect.die("Project changed during attach")

      const [expected, current] = yield* Effect.all([
        db
          .select()
          .from(ProjectAttachDirectoryTable)
          .where(eq(ProjectAttachDirectoryTable.operation_id, operation.id))
          .all()
          .pipe(Effect.orDie),
        db
          .select()
          .from(ProjectDirectoryTable)
          .where(eq(ProjectDirectoryTable.project_id, operation.project_id))
          .all()
          .pipe(Effect.orDie),
      ])
      if (!sameDirectories(expected, current)) return yield* Effect.die("Project directories changed during attach")
    })

    const rollback = Effect.fn("ProjectAttach.rollback")(function* (operation: OperationRow) {
      yield* updatePhase(operation.id, "rolling_back")
      yield* verifyRollbackState(operation)
      const sessions = yield* sessionRows(operation.id)
      yield* Effect.forEach(
        sessions,
        (session) =>
          Effect.gen(function* () {
            if (!(yield* eventExists(session.forward_event_id)) || (yield* eventExists(session.rollback_event_id)))
              return
            yield* publishMove(operation, session, "rollback")
          }),
        { discard: true },
      )
      yield* verifyRollbackState(operation)
      yield* restoreFilesystem(operation)
      yield* updatePhase(operation.id, "rolled_back")
      yield* wakeSessions(sessions)
    })

    const rollbackOrRequireRecovery = Effect.fn("ProjectAttach.rollbackOrRequireRecovery")(function* (
      operation: OperationRow,
      cause: Cause.Cause<unknown>,
    ) {
      const result = yield* Effect.exit(rollback(operation))
      if (Exit.isSuccess(result))
        return yield* new AttachError({
          projectID: operation.project_id,
          operationID: operation.id,
          reason: "operation_failed",
        })
      yield* markRecoveryRequired(operation, `${Cause.pretty(cause)}\nRollback failed: ${Cause.pretty(result.cause)}`)
      return yield* new RecoveryRequiredError({ projectID: operation.project_id, operationID: operation.id })
    })

    const finishCommitted = Effect.fn("ProjectAttach.finishCommitted")(function* (operation: OperationRow) {
      const project = yield* db
        .select({ worktree: ProjectTable.worktree, mode: ProjectTable.mode })
        .from(ProjectTable)
        .where(eq(ProjectTable.id, operation.project_id))
        .get()
        .pipe(Effect.orDie)
      if (project?.mode !== "workspace" || project.worktree !== operation.target)
        return yield* Effect.die("Committed attach Project state is unavailable")
      if (!(yield* fs.isDir(operation.target))) return yield* Effect.die("Committed attach target is unavailable")
      yield* updatePhase(operation.id, "cleanup_pending")
      if (yield* fs.exists(operation.source)) {
        if (
          (yield* fs.readFileStringSafe(markerPath(operation, operation.source))) !== operation.id ||
          !(yield* ownsTarget(operation))
        )
          return yield* Effect.die("Attach cleanup ownership is ambiguous")
        yield* fs.remove(operation.source, { recursive: true, force: true }).pipe(Effect.orDie)
      }
      yield* fs.remove(markerPath(operation, operation.target), { force: true }).pipe(Effect.orDie)
      yield* updatePhase(operation.id, "completed")
      yield* wakeSessions(yield* sessionRows(operation.id))
      return (yield* latest(operation.project_id))!
    })

    const finishCommittedOrRequireRecovery = Effect.fn("ProjectAttach.finishCommittedOrRequireRecovery")(function* (
      operation: OperationRow,
    ) {
      const result = yield* Effect.exit(finishCommitted(operation))
      if (Exit.isSuccess(result)) return result.value
      yield* markRecoveryRequired(operation, Cause.pretty(result.cause))
      return yield* new RecoveryRequiredError({ projectID: operation.project_id, operationID: operation.id })
    })

    const recoverOperation = Effect.fn("ProjectAttach.recoverOperation")(function* (operation: OperationRow) {
      if (operation.phase === "completed" || operation.phase === "rolled_back") return operation
      if (yield* isCommitted(operation)) return yield* finishCommittedOrRequireRecovery(operation)
      const result = yield* Effect.exit(rollback(operation))
      if (Exit.isSuccess(result)) return (yield* latest(operation.project_id))!
      yield* markRecoveryRequired(operation, Cause.pretty(result.cause))
      return yield* new RecoveryRequiredError({ projectID: operation.project_id, operationID: operation.id })
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

    const recoverLatest = Effect.fn("ProjectAttach.recoverLatest")(function* (projectID: ProjectSchema.ID) {
      const operation = yield* latest(projectID)
      if (!operation || finishedPhases.includes(operation.phase)) return operation
      return yield* withPathLocks([operation.source, operation.target], recoverOperation(operation))
    })

    const prepare = Effect.fn("ProjectAttach.prepare")(function* (
      project: typeof ProjectTable.$inferSelect,
      target: AbsolutePath,
      targetExists: boolean,
    ) {
      const id = ProjectSchema.AttachOperationID.create()
      const operation = {
        id,
        project_id: project.id,
        source: project.worktree,
        target,
        staging: AbsolutePath.make(`${target}.hena-attach-${id}`),
        target_existed: targetExists,
        phase: "prepared" as const,
        error: null,
        time_created: Date.now(),
        time_updated: Date.now(),
      }
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
      const directories = yield* db
        .select()
        .from(ProjectDirectoryTable)
        .where(eq(ProjectDirectoryTable.project_id, project.id))
        .all()
        .pipe(Effect.orDie)
      yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.insert(ProjectAttachOperationTable).values(operation).run()
            if (sessions.length > 0)
              yield* tx
                .insert(ProjectAttachSessionTable)
                .values(
                  sessions.map((session) => ({
                    operation_id: id,
                    session_id: session.id,
                    directory: AbsolutePath.make(session.directory),
                    path: session.path,
                    workspace_id: session.workspaceID,
                    forward_event_id: EventV2.ID.make(`evt_attach_${id}_${session.id}_forward`),
                    rollback_event_id: EventV2.ID.make(`evt_attach_${id}_${session.id}_rollback`),
                  })),
                )
                .run()
            if (directories.length > 0)
              yield* tx
                .insert(ProjectAttachDirectoryTable)
                .values(
                  directories.map((directory) => ({
                    operation_id: id,
                    directory: directory.directory,
                    type: directory.type,
                    strategy: directory.strategy,
                    time_created: directory.time_created,
                  })),
                )
                .run()
          }),
        )
        .pipe(Effect.orDie)
      return operation
    })

    const execute = Effect.fn("ProjectAttach.execute")(function* (operation: OperationRow) {
      const sessions = yield* sessionRows(operation.id)
      const active = yield* execution.active
      yield* Effect.forEach(
        sessions.filter((session) => active.has(session.session_id)),
        (session) => execution.interrupt(session.session_id),
        { discard: true },
      )

      yield* fs.writeFileString(markerPath(operation, operation.source), operation.id).pipe(Effect.orDie)
      yield* Effect.tryPromise(async () => {
        const { cp } = await import("fs/promises")
        await cp(operation.source, operation.staging, {
          recursive: true,
          errorOnExist: true,
          force: false,
          preserveTimestamps: true,
        })
      })
      yield* fs.writeFileString(markerPath(operation, operation.staging), operation.id).pipe(Effect.orDie)
      yield* updatePhase(operation.id, "copied")

      if (yield* fs.exists(operation.target)) {
        if (!(yield* fs.isDir(operation.target))) return yield* Effect.die("Attach target is no longer a directory")
        if ((yield* fs.readDirectory(operation.target).pipe(Effect.orDie)).length > 0)
          return yield* Effect.die("Attach target is no longer empty")
        yield* fs.remove(operation.target, { recursive: true }).pipe(Effect.orDie)
      }
      yield* fs.rename(operation.staging, operation.target).pipe(Effect.orDie)
      yield* updatePhase(operation.id, "target_ready")

      const currentSessions = yield* db
        .select({
          id: SessionTable.id,
          directory: SessionTable.directory,
          path: SessionTable.path,
          workspaceID: SessionTable.workspace_id,
        })
        .from(SessionTable)
        .where(eq(SessionTable.project_id, operation.project_id))
        .all()
        .pipe(Effect.orDie)
      if (
        currentSessions.length !== sessions.length ||
        currentSessions.some(
          (session) =>
            !sessions.some(
              (snapshot) =>
                snapshot.session_id === session.id &&
                snapshot.directory === session.directory &&
                snapshot.path === session.path &&
                snapshot.workspace_id === session.workspaceID,
            ),
        )
      )
        return yield* Effect.die("Project sessions changed during attach")

      yield* Effect.forEach(sessions, (session) => publishMove(operation, session, "forward"), { discard: true })
      yield* updatePhase(operation.id, "sessions_moved")
      yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const projectedSessions = yield* tx
              .select({
                id: SessionTable.id,
                directory: SessionTable.directory,
                path: SessionTable.path,
                workspaceID: SessionTable.workspace_id,
              })
              .from(SessionTable)
              .where(eq(SessionTable.project_id, operation.project_id))
              .all()
            if (
              projectedSessions.length !== sessions.length ||
              projectedSessions.some(
                (session) =>
                  !sessions.some(
                    (snapshot) =>
                      snapshot.session_id === session.id &&
                      session.directory === path.join(operation.target, snapshot.path ?? "") &&
                      session.path === snapshot.path &&
                      session.workspaceID === null,
                  ),
              )
            )
              return yield* Effect.die("Project sessions changed during attach")
            const project = yield* tx
              .select({ worktree: ProjectTable.worktree, mode: ProjectTable.mode })
              .from(ProjectTable)
              .where(eq(ProjectTable.id, operation.project_id))
              .get()
            if (project?.mode !== "chat" || project.worktree !== operation.source)
              return yield* Effect.die("Project changed during attach")
            const [expectedDirectories, currentDirectories] = yield* Effect.all([
              tx
                .select()
                .from(ProjectAttachDirectoryTable)
                .where(eq(ProjectAttachDirectoryTable.operation_id, operation.id))
                .all(),
              tx
                .select()
                .from(ProjectDirectoryTable)
                .where(eq(ProjectDirectoryTable.project_id, operation.project_id))
                .all(),
            ])
            if (!sameDirectories(expectedDirectories, currentDirectories))
              return yield* Effect.die("Project directories changed during attach")
            yield* tx
              .update(ProjectTable)
              .set({ worktree: operation.target, mode: "workspace", time_updated: Date.now() })
              .where(eq(ProjectTable.id, operation.project_id))
              .run()
            yield* tx
              .delete(ProjectDirectoryTable)
              .where(eq(ProjectDirectoryTable.project_id, operation.project_id))
              .run()
            yield* tx
              .insert(ProjectDirectoryTable)
              .values({ project_id: operation.project_id, directory: operation.target, strategy: "attach" })
              .run()
            yield* tx
              .update(ProjectAttachOperationTable)
              .set({ phase: "committed", time_updated: Date.now() })
              .where(eq(ProjectAttachOperationTable.id, operation.id))
              .run()
          }),
        )
        .pipe(Effect.orDie)
      return yield* finishCommittedOrRequireRecovery({ ...operation, phase: "committed" })
    })

    const attach: Interface["attach"] = Effect.fn("ProjectAttach.attach")(function* (input) {
      return yield* withProjectLock(
        input.projectID,
        Effect.uninterruptible(
          Effect.gen(function* () {
            yield* recoverLatest(input.projectID)
            const project = yield* requireProject(input.projectID)
            if (project.mode !== "chat")
              return yield* new AttachError({ projectID: input.projectID, reason: "not_chat" })

            const source = project.worktree
            const resolvedSource = yield* fs.resolve(source)
            const requestedTarget = path.resolve(input.directory)
            const requestedTargetExists = yield* fs.exists(requestedTarget).pipe(Effect.orDie)
            const target = AbsolutePath.make(
              requestedTargetExists
                ? yield* fs.resolve(requestedTarget)
                : path.join(yield* fs.resolve(path.dirname(requestedTarget)), path.basename(requestedTarget)),
            )
            if (requestedTargetExists && target !== requestedTarget)
              return yield* new AttachError({ projectID: input.projectID, reason: "invalid_target" })
            const relative = path.relative(resolvedSource, target)
            if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative)))
              return yield* new AttachError({ projectID: input.projectID, reason: "invalid_target" })
            if (!(yield* fs.isDir(source)))
              return yield* new AttachError({ projectID: input.projectID, reason: "operation_failed" })

            const targetExists = yield* fs.exists(target).pipe(Effect.orDie)
            if (targetExists) {
              if (!(yield* fs.isDir(target)))
                return yield* new AttachError({ projectID: input.projectID, reason: "invalid_target" })
              if ((yield* fs.readDirectory(target).pipe(Effect.orDie)).length > 0)
                return yield* new AttachError({ projectID: input.projectID, reason: "target_not_empty" })
            }
            yield* fs.makeDirectory(path.dirname(target), { recursive: true }).pipe(Effect.orDie)

            return yield* withPathLocks(
              [AbsolutePath.make(resolvedSource), target],
              Effect.gen(function* () {
                const operation = yield* prepare(project, target, targetExists)
                const result = yield* Effect.exit(execute(operation))
                if (Exit.isSuccess(result)) return operationInfo(result.value)
                const current = (yield* latest(input.projectID))!
                if (yield* isCommitted(current)) return operationInfo(yield* finishCommittedOrRequireRecovery(current))
                return yield* rollbackOrRequireRecovery(current, result.cause)
              }),
            )
          }),
        ),
      )
    })

    const get: Interface["get"] = Effect.fn("ProjectAttach.get")(function* (projectID) {
      yield* requireProject(projectID)
      const operation = yield* latest(projectID)
      return operation ? operationInfo(operation) : undefined
    })

    const recover: Interface["recover"] = Effect.fn("ProjectAttach.recover")(function* (projectID) {
      yield* requireProject(projectID)
      const operation = yield* withProjectLock(projectID, recoverLatest(projectID))
      return operation ? operationInfo(operation) : undefined
    })

    const recoverAll = db
      .select()
      .from(ProjectAttachOperationTable)
      .where(notInArray(ProjectAttachOperationTable.phase, startupRecoveryPhases))
      .all()
      .pipe(
        Effect.orDie,
        Effect.flatMap((operations) =>
          Effect.forEach(
            operations,
            (operation) =>
              withProjectLock(
                operation.project_id,
                withPathLocks([operation.source, operation.target], recoverOperation(operation)),
              ).pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("Project attach recovery failed", {
                    projectID: operation.project_id,
                    operationID: operation.id,
                    cause,
                  }),
                ),
              ),
            { discard: true },
          ),
        ),
      )

    return Service.of({ attach, get, recover, recoverAll })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer: layer.pipe(Layer.orDie),
  deps: [Database.node, EventV2.node, SessionExecution.node, FSUtil.node, EffectFlock.node],
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
