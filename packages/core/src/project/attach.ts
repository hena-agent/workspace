export * as ProjectAttach from "./attach"

import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { eq } from "drizzle-orm"
import path from "path"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { SessionExecution } from "../session/execution"
import { SessionEvent } from "../session/event"
import { SessionTable } from "../session/sql"
import { AbsolutePath, RelativePath } from "../schema"
import { ProjectSchema } from "./schema"
import { ProjectDirectoryTable, ProjectTable } from "./sql"

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("ProjectAttach.NotFoundError", {
  projectID: ProjectSchema.ID,
}) {}

export class AttachError extends Schema.TaggedErrorClass<AttachError>()("ProjectAttach.AttachError", {
  projectID: ProjectSchema.ID,
  reason: Schema.Literals(["not_chat", "invalid_target", "target_not_empty", "move_failed"]),
}) {}

export type Error = NotFoundError | AttachError

export interface Interface {
  readonly attach: (input: {
    projectID: ProjectSchema.ID
    directory: AbsolutePath
  }) => Effect.Effect<void, Error>
}

export class Service extends Context.Service<Service, Interface>()("@hena/ProjectAttach") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const events = yield* EventV2.Service
    const execution = yield* SessionExecution.Service
    const fs = yield* FSUtil.Service

    const attach = Effect.fn("ProjectAttach.attach")(function* (input: {
      projectID: ProjectSchema.ID
      directory: AbsolutePath
    }) {
      const project = yield* db
        .select()
        .from(ProjectTable)
        .where(eq(ProjectTable.id, input.projectID))
        .get()
        .pipe(Effect.orDie)
      if (!project) return yield* new NotFoundError({ projectID: input.projectID })
      if (project.mode !== "chat") return yield* new AttachError({ projectID: input.projectID, reason: "not_chat" })

      const source = project.worktree
      const target = AbsolutePath.make(path.resolve(input.directory))
      const relative = path.relative(source, target)
      if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative)))
        return yield* new AttachError({ projectID: input.projectID, reason: "invalid_target" })

      const targetExists = yield* fs.exists(target).pipe(Effect.orDie)
      if (targetExists) {
        if (!(yield* fs.isDir(target).pipe(Effect.orDie)))
          return yield* new AttachError({ projectID: input.projectID, reason: "invalid_target" })
        if ((yield* fs.readDirectory(target).pipe(Effect.orDie)).length > 0)
          return yield* new AttachError({ projectID: input.projectID, reason: "target_not_empty" })
        yield* fs.remove(target, { recursive: true }).pipe(Effect.orDie)
      }
      yield* fs.makeDirectory(path.dirname(target), { recursive: true }).pipe(Effect.orDie)

      const sessions = yield* db
        .select({ id: SessionTable.id, path: SessionTable.path })
        .from(SessionTable)
        .where(eq(SessionTable.project_id, project.id))
        .all()
        .pipe(Effect.orDie)
      yield* Effect.forEach(sessions, (session) => execution.interrupt(session.id), { discard: true })

      const move = (from: AbsolutePath, to: AbsolutePath) =>
        fs.rename(from, to).pipe(
          Effect.catch(() =>
            Effect.tryPromise(async () => {
              const { cp, rm } = await import("fs/promises")
              await cp(from, to, { recursive: true, errorOnExist: true })
              await rm(from, { recursive: true })
            }),
          ),
        )
      yield* move(source, target).pipe(
        Effect.catch(() =>
          fs.remove(target, { recursive: true, force: true }).pipe(
            Effect.ignore,
            Effect.andThen(
              targetExists ? fs.makeDirectory(target, { recursive: true }).pipe(Effect.ignore) : Effect.void,
            ),
            Effect.andThen(Effect.fail(new AttachError({ projectID: input.projectID, reason: "move_failed" }))),
          ),
        ),
      )

      yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* tx
              .update(ProjectTable)
              .set({ worktree: target, mode: "workspace", time_updated: Date.now() })
              .where(eq(ProjectTable.id, project.id))
              .run()
            yield* tx.delete(ProjectDirectoryTable).where(eq(ProjectDirectoryTable.project_id, project.id)).run()
            yield* tx
              .insert(ProjectDirectoryTable)
              .values({ project_id: project.id, directory: target, strategy: "attach" })
              .run()
            yield* Effect.forEach(
              sessions,
              (session) =>
                tx
                  .update(SessionTable)
                  .set({ directory: AbsolutePath.make(path.join(target, session.path ?? "")), time_updated: Date.now() })
                  .where(eq(SessionTable.id, session.id))
                  .run(),
              { discard: true },
            )
          }),
        )
        .pipe(
          Effect.onError(() => move(target, source).pipe(Effect.orDie)),
          Effect.mapError(() => new AttachError({ projectID: input.projectID, reason: "move_failed" })),
        )

      yield* Effect.forEach(
        sessions,
        (session) =>
          Effect.gen(function* () {
            yield* events.publish(
              SessionEvent.Moved,
              {
                sessionID: session.id,
                timestamp: yield* DateTime.now,
                location: Location.Ref.make({ directory: target }),
                subdirectory: session.path ? RelativePath.make(session.path) : undefined,
              },
              { location: Location.Ref.make({ directory: target }) },
            )
          }).pipe(Effect.ignore),
        { discard: true },
      )
    })

    return Service.of({ attach })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer: layer.pipe(Layer.orDie),
  deps: [Database.node, EventV2.node, SessionExecution.node, FSUtil.node],
})
