import { describe, expect } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Cause, Effect, Exit, Schema } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@hena/core/database/database"
import { AppNodeBuilder } from "@hena/core/effect/app-node-builder"
import { LayerNode } from "@hena/core/effect/layer-node"
import { ProjectV2 } from "@hena/core/project"
import { AbsolutePath } from "@hena/core/schema"
import { SessionV2 } from "@hena/core/session"
import { SessionContextEpochTable, SessionTable } from "@hena/core/session/sql"
import { Hash } from "@hena/core/util/hash"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([ProjectV2.node, Database.node])))

function remoteID(remote: string) {
  return ProjectV2.ID.make(Hash.fast(`git-remote:${remote}`))
}

function abs(value: string) {
  return AbsolutePath.make(value)
}

function real(value: string) {
  return Effect.promise(() => fs.realpath(value)).pipe(Effect.map((value) => AbsolutePath.make(value)))
}

async function initRepo(dir: string, opts?: { commit?: boolean; remote?: string }) {
  await $`git init`.cwd(dir).quiet()
  await $`git config core.fsmonitor false`.cwd(dir).quiet()
  await $`git config commit.gpgsign false`.cwd(dir).quiet()
  await $`git config user.email test@hena.test`.cwd(dir).quiet()
  await $`git config user.name Test`.cwd(dir).quiet()
  if (opts?.commit) await $`git commit --allow-empty -m root`.cwd(dir).quiet()
  if (opts?.remote) await $`git remote add origin ${opts.remote}`.cwd(dir).quiet()
}

async function rootCommit(dir: string) {
  return (await $`git rev-list --max-parents=0 HEAD`.cwd(dir).text()).trim()
}

describe("ProjectV2.resolve", () => {
  it.live("returns global for non-git directory", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(tmp.path))

      expect(result.id).toBe(ProjectV2.ID.make("global"))
      expect(path.resolve(result.directory)).toBe(path.parse(tmp.path).root)
      expect(result.previous).toBeUndefined()
      expect(result.vcs).toBeUndefined()
    }),
  )

  it.live("returns git global for repo with no commits and no remote", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(tmp.path))
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(tmp.path))

      expect(result.id).toBe(ProjectV2.ID.make("global"))
      expect(result.directory).toBe(yield* real(tmp.path))
      expect(result.previous).toBeUndefined()
      expect(result.vcs?.type).toBe("git")
    }),
  )

  it.live("falls back to root commit when origin is missing", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(tmp.path, { commit: true }))
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(tmp.path))

      expect(result.id).toBe(ProjectV2.ID.make(yield* Effect.promise(() => rootCommit(tmp.path))))
      expect(result.directory).toBe(yield* real(tmp.path))
      expect(result.previous).toBeUndefined()
      expect(result.vcs?.type).toBe("git")
    }),
  )

  it.live("prefers normalized origin over root commit", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(tmp.path, { commit: true, remote: "git@github.com:Acme/App.git" }))
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(tmp.path))

      expect(result.id).toBe(remoteID("github.com/Acme/App"))
      expect(result.id).not.toBe(ProjectV2.ID.make(yield* Effect.promise(() => rootCommit(tmp.path))))
      expect(result.directory).toBe(yield* real(tmp.path))
      expect(result.vcs?.type).toBe("git")
    }),
  )

  it.live("normalizes ssh and https remotes to the same id", () =>
    Effect.gen(function* () {
      const ssh = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const https = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(ssh.path, { commit: true, remote: "git@github.com:owner/repo.git" }))
      yield* Effect.promise(() => initRepo(https.path, { commit: true, remote: "https://github.com/owner/repo.git" }))
      const project = yield* ProjectV2.Service

      const a = yield* project.resolve(abs(ssh.path))
      const b = yield* project.resolve(abs(https.path))

      expect(a.id).toBe(remoteID("github.com/owner/repo"))
      expect(b.id).toBe(a.id)
    }),
  )

  it.live("ignores file remotes and falls back to root commit", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(tmp.path, { commit: true, remote: `file://${tmp.path}` }))
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(tmp.path))

      expect(result.id).toBe(ProjectV2.ID.make(yield* Effect.promise(() => rootCommit(tmp.path))))
    }),
  )

  it.live("returns previous cached id from common dir", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(tmp.path, { commit: true, remote: "git@github.com:owner/repo.git" }))
      yield* Effect.promise(() => Bun.write(path.join(tmp.path, ".git", "hena"), "old-id"))
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(tmp.path))

      expect(result.previous).toBe(ProjectV2.ID.make("old-id"))
      expect(result.id).toBe(remoteID("github.com/owner/repo"))
    }),
  )

  it.live("does not write the cache while resolving", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(tmp.path, { commit: true, remote: "git@github.com:owner/repo.git" }))
      const project = yield* ProjectV2.Service

      yield* project.resolve(abs(tmp.path))

      expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, ".git", "hena")).exists())).toBe(false)
    }),
  )

  it.live("resolves from nested directories to repo root", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(tmp.path, { commit: true }))
      yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "a", "b"), { recursive: true }))
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(path.join(tmp.path, "a", "b")))

      expect(result.directory).toBe(yield* real(tmp.path))
    }),
  )

  it.live("linked worktree returns opened worktree directory and previous from common dir", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const worktree = `${tmp.path}-worktree`
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => $`rm -rf ${worktree}`.quiet().nothrow()).pipe(Effect.ignore),
      )
      yield* Effect.promise(() => initRepo(tmp.path, { commit: true, remote: "git@github.com:owner/repo.git" }))
      yield* Effect.promise(() => Bun.write(path.join(tmp.path, ".git", "hena"), "old-id"))
      yield* Effect.promise(() => $`git worktree add ${worktree} -b test-${Date.now()}`.cwd(tmp.path).quiet())
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(worktree))

      expect(result.directory).toBe(yield* real(worktree))
      expect(result.previous).toBe(ProjectV2.ID.make("old-id"))
      expect(result.id).toBe(remoteID("github.com/owner/repo"))
      expect(result.vcs?.type).toBe("git")
    }),
  )
})

describe("ProjectV2 managed projects", () => {
  it.live("creates without a folder and preserves identity after the first attachment", () =>
    Effect.gen(function* () {
      const folder = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const project = yield* ProjectV2.Service
      const db = (yield* Database.Service).db
      const created = yield* Effect.acquireRelease(project.create({ name: "  Research  " }), (info) =>
        Effect.promise(() => fs.rm(info.worktree, { recursive: true, force: true })),
      )
      yield* Effect.promise(() => fs.mkdir(path.join(created.worktree, "notes")))
      const sessionID = SessionV2.ID.create()
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: created.id,
          mode: "general-chat",
          slug: "managed-project",
          directory: abs(path.join(created.worktree, "notes")),
          title: "Managed project session",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionContextEpochTable)
        .values({ session_id: sessionID, baseline: "chat context", snapshot: {}, baseline_seq: 0 })
        .run()
        .pipe(Effect.orDie)

      expect(created.name).toBe(ProjectV2.Name.make("Research"))
      expect(created.folder).toBeUndefined()
      expect((yield* project.resolve(abs(path.join(created.worktree, "notes")))).id).toBe(created.id)

      const attached = yield* project.attachFolder({ projectID: created.id, folder: folder.path })
      yield* Effect.promise(() => fs.mkdir(path.join(folder.path, "sources")))

      expect(attached.id).toBe(created.id)
      expect(attached.name).toBe(created.name)
      expect(attached.folder).toBe(yield* real(folder.path))
      expect((yield* project.resolve(abs(path.join(folder.path, "sources")))).id).toBe(created.id)
      expect(
        yield* db
          .select({ directory: SessionTable.directory, mode: SessionTable.mode })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie),
      ).toEqual({ directory: abs(path.join(folder.path, "notes")), mode: null })
      expect(
        yield* db
          .select({ sessionID: SessionContextEpochTable.session_id })
          .from(SessionContextEpochTable)
          .where(eq(SessionContextEpochTable.session_id, sessionID))
          .get()
          .pipe(Effect.orDie),
      ).toBeUndefined()
      expect(yield* Effect.flip(project.attachFolder({ projectID: created.id, folder: folder.path }))).toBeInstanceOf(
        ProjectV2.FolderConflictError,
      )
    }),
  )

  it.live("rejects an empty project name", () =>
    Effect.gen(function* () {
      const project = yield* ProjectV2.Service
      expect(yield* Effect.flip(project.create({ name: "   " }))).toBeInstanceOf(ProjectV2.InvalidNameError)
    }),
  )

  it.live("reports one folder conflict when concurrent creates target the same folder", () =>
    Effect.gen(function* () {
      const folder = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const project = yield* ProjectV2.Service
      const results = yield* Effect.all(
        [
          project.create({ folder: folder.path }).pipe(Effect.exit),
          project.create({ folder: folder.path }).pipe(Effect.exit),
        ],
        { concurrency: "unbounded" },
      )
      const successes = results.filter(Exit.isSuccess)
      const failures = results.filter(Exit.isFailure)
      yield* Effect.forEach(successes, (result) =>
        Effect.promise(() => fs.rm(result.value.worktree, { recursive: true, force: true })),
      )

      expect(successes).toHaveLength(1)
      expect(failures).toHaveLength(1)
      expect(Cause.squash(failures[0]!.cause)).toBeInstanceOf(ProjectV2.FolderConflictError)
    }),
  )
})
