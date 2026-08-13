import { LayerNode } from "@hena/core/effect/layer-node"
import { path } from "@hena/core/effect/app-node-platform"
import { Global } from "@/global"
import { InstanceStore } from "@/project/instance-store"
import { Project } from "@/project/project"
import type { ProjectV2 } from "@hena/core/project"
import { Slug } from "@hena/core/util/slug"
import { errorMessage } from "../util/error"
import { GlobalBus } from "@/bus/global"
import { Git } from "@/git"
import { Cause, Effect, Layer, Path, Schema, Scope, Context } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { FSUtil } from "@hena/core/fs-util"
import { AppProcess } from "@hena/core/process"
import { InstanceState } from "@/effect/instance-state"
import { WorktreeEvent } from "@hena/schema/worktree-event"
import { AbsolutePath } from "@hena/core/schema"

export const Event = WorktreeEvent

export const Info = Schema.Struct({
  name: Schema.String,
  branch: Schema.optional(Schema.String),
  directory: Schema.String,
}).annotate({ identifier: "Worktree" })
export type Info = Schema.Schema.Type<typeof Info>

export const CreateInput = Schema.Struct({
  name: Schema.optional(Schema.String),
  startCommand: Schema.optional(
    Schema.String.annotate({ description: "Additional startup script to run after the project's start command" }),
  ),
}).annotate({ identifier: "WorktreeCreateInput" })
export type CreateInput = Schema.Schema.Type<typeof CreateInput>

export const RemoveInput = Schema.Struct({
  directory: Schema.String,
}).annotate({ identifier: "WorktreeRemoveInput" })
export type RemoveInput = Schema.Schema.Type<typeof RemoveInput>

export const ResetInput = Schema.Struct({
  directory: Schema.String,
}).annotate({ identifier: "WorktreeResetInput" })
export type ResetInput = Schema.Schema.Type<typeof ResetInput>

export class NotGitError extends Schema.TaggedErrorClass<NotGitError>()("WorktreeNotGitError", {
  message: Schema.String,
}) {}

export class NameGenerationFailedError extends Schema.TaggedErrorClass<NameGenerationFailedError>()(
  "WorktreeNameGenerationFailedError",
  {
    message: Schema.String,
  },
) {}

export class CreateFailedError extends Schema.TaggedErrorClass<CreateFailedError>()("WorktreeCreateFailedError", {
  message: Schema.String,
}) {}

export class StartCommandFailedError extends Schema.TaggedErrorClass<StartCommandFailedError>()(
  "WorktreeStartCommandFailedError",
  {
    message: Schema.String,
  },
) {}

export class RemoveFailedError extends Schema.TaggedErrorClass<RemoveFailedError>()("WorktreeRemoveFailedError", {
  message: Schema.String,
}) {}

export class ResetFailedError extends Schema.TaggedErrorClass<ResetFailedError>()("WorktreeResetFailedError", {
  message: Schema.String,
}) {}

export class ListFailedError extends Schema.TaggedErrorClass<ListFailedError>()("WorktreeListFailedError", {
  message: Schema.String,
}) {}

export type Error =
  | NotGitError
  | NameGenerationFailedError
  | CreateFailedError
  | StartCommandFailedError
  | RemoveFailedError
  | ResetFailedError
  | ListFailedError

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
}

function failedRemoves(...chunks: string[]) {
  return chunks.filter(Boolean).flatMap((chunk) =>
    chunk
      .split("\n")
      .map((line) => line.trim())
      .flatMap((line) => {
        const match = line.match(/^warning:\s+failed to remove\s+(.+):\s+/i)
        if (!match) return []
        const value = match[1]?.trim().replace(/^['"]|['"]$/g, "")
        if (!value) return []
        return [value]
      }),
  )
}

// ---------------------------------------------------------------------------
// Effect service
// ---------------------------------------------------------------------------

export interface Interface {
  readonly makeWorktreeInfo: (options?: { name?: string; detached?: boolean }) => Effect.Effect<Info, Error>
  readonly createFromInfo: (info: Info, startCommand?: string) => Effect.Effect<void, Error>
  readonly create: (input?: CreateInput) => Effect.Effect<Info, Error>
  readonly list: () => Effect.Effect<(Omit<Info, "branch"> & { branch?: string })[], Error>
  readonly remove: (input: RemoveInput) => Effect.Effect<void, Error>
  readonly reset: (input: ResetInput) => Effect.Effect<boolean, Error>
}

export class Service extends Context.Service<Service, Interface>()("@hena/Worktree") {}

type GitResult = { code: number; text: string; stderr: string }

const gitMessage = (fallback: string, ...results: GitResult[]) =>
  results.flatMap((result) => [result.stderr, result.text]).find(Boolean) ?? fallback

const layer: Layer.Layer<
  Service,
  never,
  FSUtil.Service | Path.Path | AppProcess.Service | Git.Service | Project.Service | InstanceStore.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const scope = yield* Scope.Scope
    const fs = yield* FSUtil.Service
    const pathSvc = yield* Path.Path
    const appProcess = yield* AppProcess.Service
    const gitSvc = yield* Git.Service
    const project = yield* Project.Service
    const store = yield* InstanceStore.Service

    const git = Effect.fnUntraced(
      function* (args: string[], opts?: { cwd?: string }) {
        const result = yield* appProcess.run(
          ChildProcess.make("git", args, { cwd: opts?.cwd, extendEnv: true, stdin: "ignore" }),
        )
        return {
          code: result.exitCode,
          text: result.stdout.toString("utf8"),
          stderr: result.stderr.toString("utf8"),
        } satisfies GitResult
      },
      Effect.catch((e) =>
        Effect.succeed({
          code: 1,
          text: "",
          stderr: e instanceof Error ? e.message : String(e),
        } satisfies GitResult),
      ),
    )

    const MAX_NAME_ATTEMPTS = 26
    const candidate = Effect.fn("Worktree.candidate")(function* (input: {
      root: string
      name?: string
      detached?: boolean
    }) {
      const ctx = yield* InstanceState.context
      for (const attempt of Array.from({ length: MAX_NAME_ATTEMPTS }, (_, i) => i)) {
        const name = input.name ? (attempt === 0 ? input.name : `${input.name}-${Slug.create()}`) : Slug.create()
        const branch = input.detached ? undefined : `hena/${name}`
        const directory = pathSvc.join(input.root, name)

        if (yield* fs.exists(directory).pipe(Effect.orDie)) continue

        if (branch) {
          const ref = `refs/heads/${branch}`
          const branchCheck = yield* git(["show-ref", "--verify", "--quiet", ref], { cwd: ctx.worktree })
          if (branchCheck.code === 0) continue
        }

        return { name, directory, ...(branch ? { branch } : {}) }
      }
      return yield* new NameGenerationFailedError({ message: "Failed to generate a unique worktree name" })
    })

    const makeWorktreeInfo = Effect.fn("Worktree.makeWorktreeInfo")(function* (input?: {
      name?: string
      detached?: boolean
    }) {
      const ctx = yield* InstanceState.context
      if (ctx.project.vcs !== "git") {
        return yield* new NotGitError({ message: "Worktrees are only supported for git projects" })
      }

      const root = pathSvc.join(Global.Path.data, "worktree", ctx.project.id)
      yield* fs.makeDirectory(root, { recursive: true }).pipe(Effect.orDie)

      return yield* candidate({ root, name: input?.name ? slugify(input.name) : "", detached: input?.detached })
    })

    const setup = Effect.fnUntraced(function* (info: Info) {
      const ctx = yield* InstanceState.context
      const created = yield* git(
        info.branch
          ? ["worktree", "add", "--no-checkout", "-b", info.branch, info.directory]
          : ["worktree", "add", "--no-checkout", "--detach", info.directory, "HEAD"],
        { cwd: ctx.worktree },
      )
      if (created.code !== 0) {
        return yield* new CreateFailedError({
          message: gitMessage("Failed to create git worktree", created),
        })
      }
      yield* project
        .addSandbox(ctx.project.id, info.directory)
        .pipe(Effect.catchTag("Project.NotFoundError", (error) => Effect.logWarning("worktree sandbox failed", error)))
    })

    const boot = Effect.fnUntraced(function* (info: Info, startCommand?: string) {
      const ctx = yield* InstanceState.context
      const workspaceID = yield* InstanceState.workspaceID
      const projectID = ctx.project.id
      const extra = startCommand?.trim()

      const populated = yield* git(["reset", "--hard"], { cwd: info.directory })
      if (populated.code !== 0) {
        const message = gitMessage("Failed to populate worktree", populated)
        yield* Effect.logError("worktree checkout failed", { directory: info.directory, message })
        GlobalBus.emit("event", {
          directory: info.directory,
          project: ctx.project.id,
          workspace: workspaceID,
          payload: { type: Event.Failed.type, properties: { message } },
        })
        return
      }

      const booted = yield* store.load({ directory: info.directory }).pipe(
        Effect.as(true),
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            const message = errorMessage(Cause.squash(cause))
            yield* Effect.logError("worktree bootstrap failed", { directory: info.directory, message })
            GlobalBus.emit("event", {
              directory: info.directory,
              project: ctx.project.id,
              workspace: workspaceID,
              payload: { type: Event.Failed.type, properties: { message } },
            })
            return false
          }),
        ),
      )
      if (!booted) return

      GlobalBus.emit("event", {
        directory: info.directory,
        project: ctx.project.id,
        workspace: workspaceID,
        payload: {
          type: Event.Ready.type,
          properties: { name: info.name, ...(info.branch ? { branch: info.branch } : {}) },
        },
      })

      yield* runStartScripts(info.directory, { projectID, extra })
    })

    const createFromInfo = Effect.fn("Worktree.createFromInfo")(function* (info: Info, startCommand?: string) {
      yield* setup(info)
      yield* boot(info, startCommand).pipe(
        Effect.catchCause((cause) => Effect.logError("worktree bootstrap failed", { cause })),
        Effect.forkIn(scope),
      )
    })

    const create = Effect.fn("Worktree.create")(function* (input?: CreateInput) {
      const info = yield* makeWorktreeInfo({ name: input?.name })
      yield* createFromInfo(info, input?.startCommand)
      return info
    })

    const fold = (input: string) => (process.platform === "win32" ? input.toLowerCase() : input)
    const pathKey = (input: string) => fold(FSUtil.resolve(input))

    function parseWorktreeList(text: string) {
      return text
        .split("\n")
        .map((line) => line.trim())
        .reduce<{ path?: string; branch?: string }[]>((acc, line) => {
          if (!line) return acc
          if (line.startsWith("worktree ")) {
            acc.push({ path: line.slice("worktree ".length).trim() })
            return acc
          }
          const current = acc[acc.length - 1]
          if (!current) return acc
          if (line.startsWith("branch ")) {
            current.branch = line.slice("branch ".length).trim()
          }
          return acc
        }, [])
    }

    function locateWorktree(entries: { path?: string; branch?: string }[], directory: string) {
      return entries.find((item) => item.path && pathKey(item.path) === fold(directory))
    }

    const list = Effect.fn("Worktree.list")(function* () {
      const ctx = yield* InstanceState.context
      if (ctx.project.vcs !== "git") {
        return []
      }

      const entries = yield* worktreeEntries(
        ctx.worktree,
        (result) => new ListFailedError({ message: gitMessage("Failed to read git worktrees", result) }),
      )

      const primary = pathKey(ctx.project.worktree)
      const primaryName = pathSvc.basename(primary).toLowerCase()
      return entries.flatMap((entry) => {
        if (!entry.path) return []
        const directory = FSUtil.resolve(entry.path)
        if (fold(directory) === primary) return []
        const name = pathSvc.basename(directory).toLowerCase()
        return [
          {
            name: name === primaryName ? pathSvc.basename(pathSvc.dirname(directory)) : name,
            directory,
            ...(entry.branch ? { branch: entry.branch.replace(/^refs\/heads\//, "") } : {}),
          },
        ]
      })
    })

    function stopFsmonitor(target: string) {
      return fs.exists(target).pipe(
        Effect.orDie,
        Effect.flatMap((exists) => (exists ? git(["fsmonitor--daemon", "stop"], { cwd: target }) : Effect.void)),
      )
    }

    function cleanDirectory(target: string) {
      return Effect.tryPromise({
        try: async () => {
          const fsp = await import("fs/promises")
          const attempts = process.platform === "win32" ? 50 : 5
          for (const attempt of Array.from({ length: attempts }, (_, i) => i)) {
            try {
              await fsp.rm(target, { recursive: true, force: true })
              return
            } catch (error) {
              if (attempt === attempts - 1) throw error
              await new Promise((resolve) => setTimeout(resolve, 100))
            }
          }
        },
        catch: (error) =>
          new RemoveFailedError({ message: errorMessage(error) || "Failed to remove git worktree directory" }),
      })
    }

    const gitExpect = Effect.fnUntraced(function* (
      args: string[],
      opts: { cwd: string },
      error: (r: GitResult) => Error,
    ) {
      const result = yield* git(args, opts)
      if (result.code !== 0) return yield* error(result)
      return result
    })

    const removeFailed = (fallback: string, ...results: GitResult[]) =>
      new RemoveFailedError({ message: gitMessage(fallback, ...results) })

    const worktreeEntries = Effect.fnUntraced(function* (root: string, error: (result: GitResult) => Error) {
      const result = yield* gitExpect(["worktree", "list", "--porcelain"], { cwd: root }, error)
      return parseWorktreeList(result.text)
    })

    const removeGitWorktree = Effect.fnUntraced(function* (root: string, directory: string) {
      const entry = locateWorktree(
        yield* worktreeEntries(root, (result) => removeFailed("Failed to read git worktrees", result)),
        directory,
      )
      if (!entry?.path) {
        if (yield* fs.exists(directory).pipe(Effect.orDie)) {
          yield* stopFsmonitor(directory)
          yield* cleanDirectory(directory)
        }
        return
      }

      yield* stopFsmonitor(entry.path)
      const removed = yield* git(["worktree", "remove", "--force", entry.path], { cwd: root })
      if (
        removed.code !== 0 &&
        locateWorktree(
          yield* worktreeEntries(root, (result) => removeFailed("Failed to remove git worktree", removed, result)),
          directory,
        )
      ) {
        return yield* removeFailed("Failed to remove git worktree", removed)
      }

      yield* cleanDirectory(entry.path)
      const branch = entry.branch?.replace(/^refs\/heads\//, "")
      if (!branch) return
      yield* gitExpect(["branch", "-D", branch], { cwd: root }, (result) =>
        removeFailed("Failed to delete worktree branch", result),
      )
    })

    const remove = Effect.fn("Worktree.remove")(function* (input: RemoveInput) {
      const ctx = yield* InstanceState.context
      if (ctx.project.vcs !== "git") {
        return yield* new NotGitError({ message: "Worktrees are only supported for git projects" })
      }

      const directory = FSUtil.resolve(input.directory)
      if (fold(directory) !== pathKey(ctx.worktree)) yield* store.disposeDirectory(directory)

      yield* removeGitWorktree(ctx.worktree, directory)

      // Metadata is best-effort after removal: the project row may become folderless or be deleted after boot.
      return yield* project
        .removeSandbox(ctx.project.id, AbsolutePath.make(directory))
        .pipe(Effect.catchTag("Project.NotFoundError", (error) => Effect.logWarning("sandbox removal failed", error)))
    })

    const runStartCommand = Effect.fnUntraced(
      function* (directory: string, cmd: string) {
        const [shell, args] = process.platform === "win32" ? ["cmd", ["/c", cmd]] : ["bash", ["-lc", cmd]]
        const result = yield* appProcess.run(
          ChildProcess.make(shell, args, { cwd: directory, extendEnv: true, stdin: "ignore" }),
        )
        return { code: result.exitCode, stderr: result.stderr.toString("utf8") }
      },
      Effect.catch(() => Effect.succeed({ code: 1, stderr: "" })),
    )

    const runStartScript = Effect.fnUntraced(function* (directory: string, cmd: string, kind: string) {
      const text = cmd.trim()
      if (!text) return true
      const result = yield* runStartCommand(directory, text)
      if (result.code === 0) return true
      yield* Effect.logError("worktree start command failed", { kind, directory, message: result.stderr })
      return false
    })

    const runStartScripts = Effect.fnUntraced(function* (
      directory: string,
      input: { projectID: ProjectV2.ID; extra?: string },
    ) {
      const info = yield* project.get(input.projectID)
      const startup = info?.commands?.start?.trim() ?? ""
      const ok = yield* runStartScript(directory, startup, "project")
      if (!ok) return false
      yield* runStartScript(directory, input.extra ?? "", "worktree")
      return true
    })

    const prune = Effect.fnUntraced(function* (root: string, entries: string[]) {
      const base = pathKey(root)
      yield* Effect.forEach(
        entries,
        (entry) =>
          Effect.gen(function* () {
            const target = pathKey(pathSvc.resolve(root, entry))
            if (target === base) return
            if (!target.startsWith(`${base}${pathSvc.sep}`)) return
            yield* fs.remove(target, { recursive: true }).pipe(Effect.ignore)
          }),
        { concurrency: "unbounded" },
      )
    })

    const sweep = Effect.fnUntraced(function* (root: string) {
      const first = yield* git(["clean", "-ffdx"], { cwd: root })
      if (first.code === 0) return first

      const entries = failedRemoves(first.stderr, first.text)
      if (!entries.length) return first

      yield* prune(root, entries)
      return yield* git(["clean", "-ffdx"], { cwd: root })
    })

    const reset = Effect.fn("Worktree.reset")(function* (input: ResetInput) {
      const ctx = yield* InstanceState.context
      if (ctx.project.vcs !== "git") {
        return yield* new NotGitError({ message: "Worktrees are only supported for git projects" })
      }

      const directory = FSUtil.resolve(input.directory)
      const primary = FSUtil.resolve(ctx.worktree)
      if (fold(directory) === fold(primary)) {
        return yield* new ResetFailedError({ message: "Cannot reset the primary workspace" })
      }

      const entry = locateWorktree(
        yield* worktreeEntries(
          ctx.worktree,
          (result) => new ResetFailedError({ message: gitMessage("Failed to read git worktrees", result) }),
        ),
        directory,
      )
      if (!entry?.path) {
        return yield* new ResetFailedError({ message: "Worktree not found" })
      }

      const worktreePath = entry.path

      const base = yield* gitSvc.defaultBranch(ctx.worktree)
      if (!base) {
        return yield* new ResetFailedError({ message: "Default branch not found" })
      }

      const sep = base.ref.indexOf("/")
      if (base.ref !== base.name && sep > 0) {
        const remote = base.ref.slice(0, sep)
        const branch = base.ref.slice(sep + 1)
        yield* gitExpect(
          ["fetch", remote, branch],
          { cwd: ctx.worktree },
          (r) => new ResetFailedError({ message: gitMessage(`Failed to fetch ${base.ref}`, r) }),
        )
      }

      yield* gitExpect(
        ["reset", "--hard", base.ref],
        { cwd: worktreePath },
        (r) => new ResetFailedError({ message: gitMessage("Failed to reset worktree to target", r) }),
      )

      const cleanResult = yield* sweep(worktreePath)
      if (cleanResult.code !== 0) {
        return yield* new ResetFailedError({
          message: gitMessage("Failed to clean worktree", cleanResult),
        })
      }

      yield* gitExpect(
        ["submodule", "update", "--init", "--recursive", "--force"],
        { cwd: worktreePath },
        (r) => new ResetFailedError({ message: gitMessage("Failed to update submodules", r) }),
      )

      yield* gitExpect(
        ["submodule", "foreach", "--recursive", "git", "reset", "--hard"],
        { cwd: worktreePath },
        (r) => new ResetFailedError({ message: gitMessage("Failed to reset submodules", r) }),
      )

      yield* gitExpect(
        ["submodule", "foreach", "--recursive", "git", "clean", "-fdx"],
        { cwd: worktreePath },
        (r) => new ResetFailedError({ message: gitMessage("Failed to clean submodules", r) }),
      )

      const status = yield* git(["-c", "core.fsmonitor=false", "status", "--porcelain=v1"], { cwd: worktreePath })
      if (status.code !== 0) {
        return yield* new ResetFailedError({ message: gitMessage("Failed to read git status", status) })
      }

      if (status.text.trim()) {
        return yield* new ResetFailedError({ message: `Worktree reset left local changes:\n${status.text.trim()}` })
      }

      yield* runStartScripts(worktreePath, { projectID: ctx.project.id }).pipe(
        Effect.catchCause((cause) => Effect.logError("worktree start task failed", { cause })),
        Effect.forkIn(scope),
      )

      return true
    })

    return Service.of({ makeWorktreeInfo, createFromInfo, create, list, remove, reset })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [FSUtil.node, path, AppProcess.node, Git.node, Project.node, InstanceStore.node],
})

export * as Worktree from "."
