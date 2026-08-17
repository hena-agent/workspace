import { LayerNode } from "@hena/core/effect/layer-node"
import { and, eq, ne, sql } from "drizzle-orm"
import { Database } from "@hena/core/database/database"
import { ProjectDirectoryTable, ProjectTable, rooted } from "@hena/core/project/sql"
import { ProjectDirectories } from "@hena/core/project/directories"
import { SessionTable } from "@hena/core/session/sql"
import { WorkspaceTable } from "@hena/core/control-plane/workspace.sql"
import { Flag } from "@/flag"
import { GlobalBus } from "@/bus/global"
import { which } from "@hena/core/util/which"
import { Command } from "@/command"
import { InstanceState } from "@/effect/instance-state"
import { Effect, Layer, Scope, Context, Stream, Types, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { FSUtil } from "@hena/core/fs-util"
import { AppProcess } from "@hena/core/process"
import { ProjectV2 } from "@hena/core/project"
import { CrossSpawnSpawner } from "@hena/core/cross-spawn-spawner"
import { AbsolutePath } from "@hena/core/schema"
import { serviceUse } from "@hena/core/effect/service-use"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@hena/core/event"
import { Project } from "@hena/schema/project"

export const Info = Project.Info
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>

export const Event = {
  Updated: Project.Event.Updated,
}

type Row = typeof ProjectTable.$inferSelect

function decodeRow(row: Row, worktree: string): Info {
  const icon =
    row.icon_url || row.icon_url_override || row.icon_color
      ? {
          url: row.icon_url ?? undefined,
          override: row.icon_url_override ?? undefined,
          color: row.icon_color ?? undefined,
        }
      : undefined
  return {
    id: row.id,
    worktree,
    vcs: row.vcs ? Schema.decodeUnknownSync(Project.Vcs)(row.vcs) : undefined,
    name: row.name ?? undefined,
    icon,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      initialized: row.time_initialized ?? undefined,
    },
    sandboxes: row.sandboxes,
    commands: row.commands ?? undefined,
  }
}

function fromRow(row: Row): Info | undefined {
  if (row.worktree === null) return undefined
  return decodeRow(row, row.worktree)
}

export const UpdateInput = Schema.Struct({
  projectID: ProjectV2.ID,
  name: Schema.optional(Schema.String),
  icon: Schema.optional(Project.Icon),
  commands: Schema.optional(Project.Commands),
})
export type UpdateInput = Types.DeepMutable<Schema.Schema.Type<typeof UpdateInput>>

export const UpdatePayload = Schema.Struct({
  name: Schema.optional(Schema.String),
  icon: Schema.optional(Project.Icon),
  commands: Schema.optional(Project.Commands),
}).annotate({ identifier: "ProjectUpdateInput" })
export type UpdatePayload = Types.DeepMutable<Schema.Schema.Type<typeof UpdatePayload>>

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Project.NotFoundError", {
  projectID: ProjectV2.ID,
}) {}

// ---------------------------------------------------------------------------
// Effect service
// ---------------------------------------------------------------------------

export interface Interface {
  /**
   * Per-instance setup. Subscribes to the `/init` slash command for the
   * current instance and stamps the project's initialized timestamp when it
   * fires. Subscription lifetime is tied to the per-instance state scope.
   */
  readonly init: () => Effect.Effect<void>
  readonly fromDirectory: (directory: string) => Effect.Effect<{ project: Info; sandbox: string }>
  readonly discover: (input: Info) => Effect.Effect<void>
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (id: ProjectV2.ID) => Effect.Effect<Info | undefined>
  readonly update: (input: UpdateInput) => Effect.Effect<Info, NotFoundError>
  readonly initGit: (input: { directory: string; project: Info }) => Effect.Effect<Info>
  readonly setInitialized: (id: ProjectV2.ID) => Effect.Effect<void>
  readonly sandboxes: (id: ProjectV2.ID) => Effect.Effect<string[]>
  /** Adds a sandbox using `FSUtil.resolve`'s native canonical spelling. */
  readonly addSandbox: (id: ProjectV2.ID, directory: string) => Effect.Effect<void, NotFoundError>
  /** Removes an exact canonical sandbox spelling. */
  readonly removeSandbox: (id: ProjectV2.ID, sandbox: AbsolutePath) => Effect.Effect<void, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@hena/Project") {}

type GitResult = { code: number; text: string; stderr: string }

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const projectV2 = yield* ProjectV2.Service
    const projectDirectories = yield* ProjectDirectories.Service
    const events = yield* EventV2Bridge.Service
    const flags = yield* RuntimeFlags.Service
    const { db } = yield* Database.Service

    const git = Effect.fnUntraced(
      function* (args: string[], opts?: { cwd?: string }) {
        const handle = yield* spawner.spawn(
          ChildProcess.make("git", args, { cwd: opts?.cwd, extendEnv: true, stdin: "ignore" }),
        )
        const [text, stderr] = yield* Effect.all(
          [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
          { concurrency: 2 },
        )
        const code = yield* handle.exitCode
        return { code, text, stderr } satisfies GitResult
      },
      Effect.scoped,
      Effect.catch(() => Effect.succeed({ code: 1, text: "", stderr: "" } satisfies GitResult)),
    )

    const emitUpdated = (data: Info) =>
      Effect.sync(() =>
        GlobalBus.emit("event", {
          directory: "global",
          project: data.id,
          payload: { type: Event.Updated.type, properties: data },
        }),
      )

    const fakeVcs = Schema.decodeUnknownSync(Schema.optional(Project.Vcs))(Flag.HENA_FAKE_VCS)

    const scope = yield* Scope.Scope

    const migrateProjectId = Effect.fn("Project.migrateProjectId")(function* (
      oldID: ProjectV2.ID | undefined,
      newID: ProjectV2.ID,
    ) {
      if (!oldID) return
      if (oldID === ProjectV2.ID.global) return
      if (oldID === newID) return

      yield* db
        .transaction(
          (d) =>
            Effect.gen(function* () {
              const oldProject = yield* d.select().from(ProjectTable).where(eq(ProjectTable.id, oldID)).get()
              const newProject = yield* d.select().from(ProjectTable).where(eq(ProjectTable.id, newID)).get()
              if (oldProject && !newProject) {
                yield* d
                  .insert(ProjectTable)
                  .values({
                    ...oldProject,
                    id: newID,
                    time_updated: Date.now(),
                  })
                  .run()
              }

              // Project directories may be shared across distinct
              // checkouts which have diverged. Clear the directory
              // list and rely on it being re-populated to ensure
              // accuracy
              yield* d.delete(ProjectDirectoryTable).where(eq(ProjectDirectoryTable.project_id, oldID)).run()

              yield* d
                .update(SessionTable)
                .set({ project_id: newID, time_updated: sql`${SessionTable.time_updated}` })
                .where(eq(SessionTable.project_id, oldID))
                .run()
              yield* d
                .update(WorkspaceTable)
                .set({ project_id: newID })
                .where(eq(WorkspaceTable.project_id, oldID))
                .run()

              if (oldProject) yield* d.delete(ProjectTable).where(eq(ProjectTable.id, oldID)).run()
            }),
          { behavior: "immediate" },
        )
        .pipe(Effect.orDie)
    })

    const fromDirectory = Effect.fn("Project.fromDirectory")(function* (directory: string) {
      yield* Effect.logInfo("fromDirectory", { directory })

      const data = yield* projectV2.resolve(AbsolutePath.make(directory))
      const worktree = data.id === ProjectV2.ID.make("global") && !data.vcs ? "/" : data.directory
      const opened = AbsolutePath.make(FSUtil.resolve(data.directory))
      const storage = opened.replaceAll("\\", "/")

      // Phase 2: upsert
      const projectID = ProjectV2.ID.make(data.id)
      yield* migrateProjectId(data.previous ? ProjectV2.ID.make(data.previous) : undefined, projectID)
      const observed = yield* db
        .select({ sandboxes: ProjectTable.sandboxes, worktree: ProjectTable.worktree })
        .from(ProjectTable)
        .where(eq(ProjectTable.id, projectID))
        .get()
        .pipe(Effect.orDie)
      const observedSandboxes = new Set((observed?.sandboxes ?? []).map((sandbox) => FSUtil.resolve(sandbox)))
      if (observed?.worktree) observedSandboxes.delete(FSUtil.resolve(observed.worktree))
      const missingSandboxes = new Set(
        yield* Effect.filter([...observedSandboxes], (sandbox) =>
          fs.exists(sandbox).pipe(
            Effect.orDie,
            Effect.map((exists) => !exists),
          ),
        ),
      )
      const result = yield* db
        .transaction(
          (d) =>
            Effect.gen(function* () {
              const row = yield* d.select().from(ProjectTable).where(eq(ProjectTable.id, projectID)).get()
              const existing = row
                ? decodeRow(row, row.worktree ?? worktree)
                : {
                    id: projectID,
                    worktree,
                    vcs: data.vcs?.type ?? fakeVcs,
                    sandboxes: [] as string[],
                    time: { created: Date.now(), updated: Date.now() },
                  }

              const projectWorktree = projectID === ProjectV2.ID.global ? worktree : existing.worktree
              const sandboxes = new Set(existing.sandboxes.map((sandbox) => FSUtil.resolve(sandbox)))
              sandboxes.delete(FSUtil.resolve(projectWorktree))
              const sandboxSetUnchanged =
                sandboxes.size === observedSandboxes.size &&
                [...sandboxes].every((sandbox) => observedSandboxes.has(sandbox))
              const prunedSandboxes = sandboxSetUnchanged
                ? [...missingSandboxes].filter((sandbox) => sandboxes.delete(sandbox))
                : []
              yield* Effect.forEach(
                prunedSandboxes,
                (sandbox) => projectDirectories.remove({ projectID, directory: AbsolutePath.make(sandbox) }, d),
                { discard: true },
              )
              const sandbox = AbsolutePath.make(FSUtil.resolve(data.directory))
              if (projectID !== ProjectV2.ID.global && sandbox !== FSUtil.resolve(projectWorktree))
                sandboxes.add(sandbox)
              const result: Info = {
                ...existing,
                worktree: projectWorktree,
                vcs: data.vcs?.type ?? fakeVcs,
                sandboxes: [...sandboxes],
                time: { ...existing.time, updated: Date.now() },
              }

              yield* d
                .insert(ProjectTable)
                .values({
                  id: result.id,
                  worktree: AbsolutePath.make(result.worktree),
                  vcs: result.vcs ?? null,
                  name: result.name,
                  icon_url: result.icon?.url,
                  icon_url_override: result.icon?.override,
                  icon_color: result.icon?.color,
                  time_created: result.time.created,
                  time_updated: result.time.updated,
                  time_initialized: result.time.initialized,
                  sandboxes: result.sandboxes.map((sandbox) => AbsolutePath.make(sandbox)),
                  commands: result.commands,
                })
                .onConflictDoUpdate({
                  target: ProjectTable.id,
                  set: {
                    worktree: AbsolutePath.make(result.worktree),
                    vcs: result.vcs ?? null,
                    name: result.name,
                    icon_url: result.icon?.url,
                    icon_url_override: result.icon?.override,
                    icon_color: result.icon?.color,
                    time_updated: result.time.updated,
                    time_initialized: result.time.initialized,
                    sandboxes: result.sandboxes.map((sandbox) => AbsolutePath.make(sandbox)),
                    commands: result.commands,
                  },
                })
                .run()

              if (projectID !== ProjectV2.ID.global) {
                yield* d
                  .delete(ProjectDirectoryTable)
                  .where(
                    and(eq(ProjectDirectoryTable.directory, opened), ne(ProjectDirectoryTable.project_id, projectID)),
                  )
                  .run()
                yield* projectDirectories.create(
                  {
                    directory: opened,
                    projectID,
                  },
                  d,
                )
                yield* d.run(sql`
                  UPDATE session AS target
                  SET (project_id, path) = (
                    SELECT mapping.project_id,
                           ltrim(substr(target.directory, length(mapping.directory) + 1), '/')
                    FROM project_directory AS mapping
                    WHERE mapping.project_id <> ${ProjectV2.ID.global}
                      AND (
                        mapping.directory = target.directory
                        OR (
                          substr(target.directory, 1, length(mapping.directory)) = mapping.directory AND (
                            substr(mapping.directory, -1) = '/'
                            OR substr(target.directory, length(mapping.directory) + 1, 1) = '/'
                          )
                        )
                      )
                    ORDER BY length(mapping.directory) DESC, mapping.directory, mapping.project_id
                    LIMIT 1
                  )
                  WHERE target.project_id = ${ProjectV2.ID.global}
                    AND target.directory <> ''
                    AND (
                      target.directory = ${storage}
                      OR (
                        substr(target.directory, 1, length(${storage})) = ${storage} AND (
                          substr(${storage}, -1) = '/'
                          OR substr(target.directory, length(${storage}) + 1, 1) = '/'
                        )
                      )
                    )
                `)
              }
              return result
            }),
          { behavior: "immediate" },
        )
        .pipe(Effect.orDie)

      if (flags.experimentalIconDiscovery) yield* discover(result).pipe(Effect.ignore, Effect.forkIn(scope))

      yield* emitUpdated(result)
      if (projectID !== ProjectV2.ID.global && data.vcs?.type === "git") {
        yield* projectV2.commit({ store: data.vcs.store, id: data.id })
      }
      return { project: result, sandbox: data.vcs ? data.directory : worktree }
    })

    const discover = Effect.fn("Project.discover")(function* (input: Info) {
      if (input.vcs !== "git") return
      if (input.icon?.override) return
      if (input.icon?.url) return

      const matches = yield* fs
        .glob("**/favicon.{ico,png,svg,jpg,jpeg,webp}", {
          cwd: input.worktree,
          absolute: true,
          include: "file",
        })
        .pipe(Effect.orDie)
      const shortest = matches.sort((a, b) => a.length - b.length)[0]
      if (!shortest) return

      const buffer = yield* fs.readFile(shortest).pipe(Effect.orDie)
      const base64 = Buffer.from(buffer).toString("base64")
      const mime = FSUtil.mimeType(shortest)
      const url = `data:${mime};base64,${base64}`
      yield* update({ projectID: input.id, icon: { url } }).pipe(
        Effect.catchTag("Project.NotFoundError", () => Effect.void),
      )
    })

    const list = Effect.fn("Project.list")(function* () {
      return (yield* db.select().from(ProjectTable).all().pipe(Effect.orDie)).flatMap((row) => fromRow(row) ?? [])
    })

    const get = Effect.fn("Project.get")(function* (id: ProjectV2.ID) {
      const row = yield* db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get().pipe(Effect.orDie)
      return row ? fromRow(row) : undefined
    })

    const update = Effect.fn("Project.update")(function* (input: UpdateInput) {
      const result = yield* db
        .update(ProjectTable)
        .set({
          name: input.name,
          icon_url: input.icon?.url,
          icon_url_override: input.icon?.override,
          icon_color: input.icon?.color,
          commands: input.commands,
          time_updated: Date.now(),
        })
        .where(and(eq(ProjectTable.id, input.projectID), rooted))
        .returning()
        .get()
        .pipe(Effect.orDie)
      const data = result && fromRow(result)
      if (!data) return yield* new NotFoundError({ projectID: input.projectID })
      yield* emitUpdated(data)
      return data
    })

    const initGit = Effect.fn("Project.initGit")(function* (input: { directory: string; project: Info }) {
      if (input.project.vcs === "git") return input.project
      if (!(yield* Effect.sync(() => which("git")))) throw new Error("Git is not installed")
      const directory = ProjectV2.ID.isManaged(input.project.id) ? input.project.worktree : input.directory
      const result = yield* git(["init", "--quiet"], { cwd: directory })
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || result.text.trim() || "Failed to initialize git repository")
      }
      const { project } = yield* fromDirectory(directory)
      return project
    })

    const setInitialized = Effect.fn("Project.setInitialized")(function* (id: ProjectV2.ID) {
      yield* db
        .update(ProjectTable)
        .set({ time_initialized: Date.now() })
        .where(and(eq(ProjectTable.id, id), rooted))
        .run()
        .pipe(Effect.orDie)
    })

    const initState = yield* InstanceState.make(
      Effect.fn("Project.initState")(function* (ctx) {
        const unsubscribe = yield* events.listen((event) => {
          if (event.type !== Command.Event.Executed.type || event.location?.directory !== ctx.directory)
            return Effect.void
          const data = event.data as EventV2.Data<typeof Command.Event.Executed>
          return data.name === Command.Default.INIT ? setInitialized(ctx.project.id) : Effect.void
        })
        yield* Effect.addFinalizer(() => unsubscribe)
      }),
    )

    const init = Effect.fn("Project.init")(function* () {
      yield* InstanceState.get(initState)
    })

    const sandboxes = Effect.fn("Project.sandboxes")(function* (id: ProjectV2.ID) {
      const row = yield* db
        .select()
        .from(ProjectTable)
        .where(and(eq(ProjectTable.id, id), rooted))
        .get()
        .pipe(Effect.orDie)
      if (!row) return []
      return yield* Effect.filter(row.sandboxes, (directory) => fs.isDir(directory).pipe(Effect.orDie))
    })

    const writeSandboxes = Effect.fn("Project.writeSandboxes")(function* (
      id: ProjectV2.ID,
      next: (sandboxes: AbsolutePath[]) => AbsolutePath[],
      removed?: AbsolutePath,
    ) {
      const result = yield* db
        .transaction(
          (d) =>
            Effect.gen(function* () {
              // Keep both predicates so each statement independently refuses folderless rows.
              const row = yield* d
                .select()
                .from(ProjectTable)
                .where(and(eq(ProjectTable.id, id), rooted))
                .get()
              if (!row) return undefined
              const result = yield* d
                .update(ProjectTable)
                .set({ sandboxes: next(row.sandboxes), time_updated: Date.now() })
                .where(and(eq(ProjectTable.id, id), rooted))
                .returning()
                .get()
              if (
                removed &&
                FSUtil.resolve(removed) !== FSUtil.resolve(row.worktree!) &&
                row.sandboxes.some((sandbox) => FSUtil.resolve(sandbox) === FSUtil.resolve(removed))
              )
                yield* projectDirectories.remove({ projectID: id, directory: removed }, d)
              return result
            }),
          // Serialize the read-modify-write so concurrent callers cannot lose a sandbox.
          { behavior: "immediate" },
        )
        .pipe(Effect.orDie)
      const data = result && fromRow(result)
      if (!data) return yield* new NotFoundError({ projectID: id })
      return yield* emitUpdated(data)
    })

    const addSandbox = Effect.fn("Project.addSandbox")(function* (id: ProjectV2.ID, directory: string) {
      const sandbox = AbsolutePath.make(FSUtil.resolve(directory))
      yield* writeSandboxes(id, (sboxes) => (sboxes.includes(sandbox) ? sboxes : [...sboxes, sandbox]))
    })

    const removeSandbox = Effect.fn("Project.removeSandbox")(function* (id: ProjectV2.ID, sandbox: AbsolutePath) {
      yield* writeSandboxes(id, (sboxes) => sboxes.filter((item) => item !== sandbox), sandbox)
    })

    return Service.of({
      init,
      fromDirectory,
      discover,
      list,
      get,
      update,
      initGit,
      setInitialized,
      sandboxes,
      addSandbox,
      removeSandbox,
    })
  }),
)

export const use = serviceUse(Service)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [
    FSUtil.node,
    AppProcess.node,
    CrossSpawnSpawner.node,
    ProjectV2.node,
    ProjectDirectories.node,
    EventV2Bridge.node,
    RuntimeFlags.node,
    Database.node,
  ],
})

export * as Project from "./project"
