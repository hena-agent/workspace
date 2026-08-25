export * as ProjectV2 from "./project"
export * as Project from "./project"

import { Context, Effect, Layer, Schema } from "effect"
import path from "path"
import { AbsolutePath } from "./schema"
import { FSUtil } from "./fs-util"
import { Git } from "./git"
import { Global } from "./global"
import { makeGlobalNode } from "./effect/app-node"
import { Hash } from "./util/hash"
import { ProjectDirectories } from "./project/directories"
import { ProjectSchema } from "./project/schema"

export const ID = ProjectSchema.ID
export type ID = ProjectSchema.ID

export const Vcs = ProjectSchema.Vcs
export type Vcs = ProjectSchema.Vcs

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
  readonly create: () => Effect.Effect<Resolved>
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
    const fs = yield* FSUtil.Service
    const git = yield* Git.Service
    const global = yield* Global.Service
    const projectDirectories = yield* ProjectDirectories.Service

    const projects = AbsolutePath.make(FSUtil.resolve(global.projects))

    const create = Effect.fn("Project.create")(function* () {
      yield* fs.ensureDir(projects, 0o700).pipe(Effect.orDie)
      if (process.platform !== "win32") yield* fs.chmod(projects, 0o700).pipe(Effect.orDie)
      const id = ID.create()
      const directory = AbsolutePath.make(path.join(projects, id))
      return yield* Effect.gen(function* () {
        yield* fs.ensureDir(directory, 0o700).pipe(Effect.orDie)
        if (process.platform !== "win32") yield* fs.chmod(directory, 0o700).pipe(Effect.orDie)
        return { id, directory }
      }).pipe(Effect.onError(() => fs.remove(directory, { recursive: true, force: true }).pipe(Effect.ignore)))
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

    const managedProject = (directory: string) => {
      const id = path.relative(projects, directory).split(path.sep)[0]
      if (!id || !ID.isManaged(id)) return undefined
      return { id: ID.make(id), directory: AbsolutePath.make(path.join(projects, id)) }
    }

    const resolveRepository = Effect.fnUntraced(function* (repo: Git.Repository, fallback?: ID) {
      const cachedID = yield* cached(repo.commonDirectory)
      const id = (yield* remote(repo)) ?? cachedID ?? (yield* root(repo)) ?? fallback ?? ID.global
      return {
        previous: cachedID ?? (fallback !== id ? fallback : undefined),
        id,
        directory: repo.worktree,
        vcs: { type: "git" as const, store: repo.commonDirectory },
      }
    })

    const resolve = Effect.fn("Project.resolve")(function* (input: AbsolutePath) {
      const directory = AbsolutePath.make(FSUtil.resolve(input))
      const managed = managedProject(directory)
      if (managed) {
        const found = yield* git.repo.discover(managed.directory)
        const repository = found?.worktree === managed.directory ? found : undefined
        if (repository) return yield* resolveRepository(repository, managed.id)
        return managed
      }

      const repo = yield* git.repo.discover(input)
      const repositories = repo ? [repo] : []
      let enclosing = repo
      while (enclosing) {
        const common = path.dirname(enclosing.commonDirectory)
        const shared = managedProject(common)
        if (shared?.directory === common) {
          return yield* resolveRepository(enclosing, shared.id)
        }
        const parent = path.dirname(enclosing.worktree)
        if (parent === enclosing.worktree) break
        const outer = yield* git.repo.discover(AbsolutePath.make(parent))
        if (outer?.worktree === enclosing.worktree) break
        enclosing = outer
        if (outer) repositories.push(outer)
      }

      if (!repo) return { id: ID.global, directory: AbsolutePath.make(path.parse(input).root), vcs: undefined }

      const separate = yield* fs.glob("*/.git", { cwd: projects, absolute: true, include: "file" }).pipe(
        Effect.flatMap((files) =>
          Effect.forEach(files, (file) => git.repo.discover(AbsolutePath.make(path.dirname(file))), {
            concurrency: 8,
          }),
        ),
        Effect.catch(() => Effect.succeed([])),
      )
      const repository = repositories.find((repository) =>
        separate.some((candidate) => candidate?.commonDirectory === repository.commonDirectory),
      )
      const managedRoot = repository
        ? separate.find((candidate) => candidate?.commonDirectory === repository.commonDirectory)
        : undefined
      const shared = managedRoot ? managedProject(managedRoot.worktree) : undefined
      if (repository && managedRoot && shared?.directory === managedRoot.worktree) {
        return yield* resolveRepository(repository, shared.id)
      }

      return yield* resolveRepository(repo)
    })

    const commit = Effect.fn("Project.commit")(function* (input: { store: AbsolutePath; id: ID }) {
      if (ID.isManaged(input.id)) return
      yield* fs.writeFileString(path.join(input.store, "hena"), input.id).pipe(Effect.ignore)
    })

    return Service.of({ create, directories, resolve, commit })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer: layer,
  deps: [FSUtil.node, Git.node, Global.node, ProjectDirectories.node],
})
