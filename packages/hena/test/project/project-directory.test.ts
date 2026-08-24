import { describe, expect } from "bun:test"
import { $ } from "bun"
import path from "path"
import { eq } from "drizzle-orm"
import { LayerNode } from "@hena/core/effect/layer-node"
import { CrossSpawnSpawner } from "@hena/core/cross-spawn-spawner"
import { Effect } from "effect"
import { Hash } from "@hena/core/util/hash"
import { AbsolutePath } from "@hena/core/schema"
import { Database } from "@hena/core/database/database"
import { ProjectDirectoryTable, ProjectTable } from "@hena/core/project/sql"
import { ProjectV2 } from "@hena/core/project"
import { Project } from "@/project/project"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Project.node, Database.node, CrossSpawnSpawner.node])))

function directories(projectID: ProjectV2.ID) {
  return Database.Service.use(({ db }) =>
    db
      .select()
      .from(ProjectDirectoryTable)
      .where(eq(ProjectDirectoryTable.project_id, projectID))
      .all()
      .pipe(
        Effect.orDie,
        Effect.map((rows) =>
          rows
            .map((row) => ({ directory: row.directory, strategy: row.strategy ?? undefined }))
            .toSorted((a, b) => a.directory.localeCompare(b.directory)),
        ),
      ),
  )
}

describe("Project directory persistence", () => {
  it.live("stores the first opened checkout directory", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const project = yield* Project.Service

      const result = yield* project.fromDirectory(tmp)

      expect(yield* directories(result.project.id)).toEqual([
        { directory: AbsolutePath.make(tmp), strategy: undefined },
      ])
    }),
  )

  it.live("stores a repeatedly opened checkout directory only once", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const project = yield* Project.Service

      const result = yield* project.fromDirectory(tmp)
      const next = yield* project.fromDirectory(tmp)

      expect(next.project.id).toBe(result.project.id)
      expect(yield* directories(result.project.id)).toEqual([
        { directory: AbsolutePath.make(tmp), strategy: undefined },
      ])
    }),
  )

  it.live("replaces an exact directory mapping owned by another project", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const staleID = ProjectV2.ID.make("stale-directory-owner")
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({
          id: staleID,
          worktree: AbsolutePath.make(tmp + "-stale"),
          vcs: "git",
          time_created: Date.now(),
          time_updated: Date.now(),
          sandboxes: [],
        })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(ProjectDirectoryTable)
        .values({ project_id: staleID, directory: AbsolutePath.make(tmp) })
        .run()
        .pipe(Effect.orDie)

      const result = yield* (yield* Project.Service).fromDirectory(tmp)
      const rows = yield* db
        .select()
        .from(ProjectDirectoryTable)
        .where(eq(ProjectDirectoryTable.directory, AbsolutePath.make(tmp)))
        .all()
        .pipe(Effect.orDie)

      expect(rows.map((row) => row.project_id)).toEqual([result.project.id])
    }),
  )

  it.live("stores an opened linked worktree directory", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const project = yield* Project.Service
      const main = yield* project.fromDirectory(tmp)
      const worktree = path.join(tmp, "..", path.basename(tmp) + "-project-directory-worktree")
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => $`git worktree remove ${worktree}`.cwd(tmp).quiet().nothrow()).pipe(Effect.ignore),
      )
      yield* Effect.promise(() => $`git worktree add ${worktree} -b project-directory-${Date.now()}`.cwd(tmp).quiet())

      yield* project.fromDirectory(worktree)

      expect(yield* directories(main.project.id)).toEqual(
        [
          { directory: AbsolutePath.make(tmp), strategy: undefined },
          { directory: AbsolutePath.make(worktree), strategy: undefined },
        ].toSorted((a, b) => a.directory.localeCompare(b.directory)),
      )
    }),
  )

  it.live("removes a linked worktree directory mapping with its sandbox", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const project = yield* Project.Service
      const main = yield* project.fromDirectory(tmp)
      const worktree = path.join(tmp, "..", path.basename(tmp) + "-project-directory-remove")
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => $`git worktree remove ${worktree}`.cwd(tmp).quiet().nothrow()).pipe(Effect.ignore),
      )
      yield* Effect.promise(() => $`git worktree add --detach ${worktree} HEAD`.cwd(tmp).quiet())
      yield* project.fromDirectory(worktree)

      yield* project.removeSandbox(main.project.id, AbsolutePath.make(tmp))
      expect(yield* directories(main.project.id)).toContainEqual({
        directory: AbsolutePath.make(tmp),
        strategy: undefined,
      })
      yield* project.removeSandbox(main.project.id, AbsolutePath.make(worktree))

      expect(yield* directories(main.project.id)).toEqual([{ directory: AbsolutePath.make(tmp), strategy: undefined }])
    }),
  )

  it.live("removes directory mappings for pruned missing sandboxes", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const project = yield* Project.Service
      const main = yield* project.fromDirectory(tmp)
      const worktree = path.join(tmp, "..", path.basename(tmp) + "-project-directory-pruned")
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => $`rm -rf ${worktree}`.quiet().nothrow()).pipe(Effect.ignore),
      )
      yield* Effect.promise(() => $`git worktree add --detach ${worktree} HEAD`.cwd(tmp).quiet())
      yield* project.fromDirectory(worktree)
      yield* Effect.promise(() => $`git worktree remove --force ${worktree}`.cwd(tmp).quiet())

      yield* project.fromDirectory(tmp)
      yield* Effect.promise(() => $`mkdir -p ${worktree}`.quiet())
      const reused = yield* project.fromDirectory(worktree)

      expect(reused.project.id).toBe(ProjectV2.ID.global)
      expect(yield* directories(main.project.id)).toEqual([{ directory: AbsolutePath.make(tmp), strategy: undefined }])
    }),
  )

  it.live("stores only the linked copy when first opened from an external linked worktree", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const worktree = path.join(tmp, "..", path.basename(tmp) + "-project-directory-first-worktree")
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => $`git worktree remove ${worktree}`.cwd(tmp).quiet().nothrow()).pipe(Effect.ignore),
      )
      yield* Effect.promise(() => $`git worktree add --detach ${worktree} HEAD`.cwd(tmp).quiet())
      const project = yield* Project.Service

      const result = yield* project.fromDirectory(worktree)

      expect(yield* directories(result.project.id)).toEqual([
        { directory: AbsolutePath.make(worktree), strategy: undefined },
      ])
    }),
  )

  it.live("stores a separately opened clone as a secondary directory", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const bare = tmp + "-project-directory-bare"
      const clone = tmp + "-project-directory-clone"
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => $`rm -rf ${bare} ${clone}`.quiet().nothrow()).pipe(Effect.ignore),
      )
      yield* Effect.promise(() => $`git clone --bare ${tmp} ${bare}`.quiet())
      yield* Effect.promise(() => $`git clone ${bare} ${clone}`.quiet())
      const project = yield* Project.Service
      const main = yield* project.fromDirectory(tmp)

      yield* project.fromDirectory(clone)

      expect(yield* directories(main.project.id)).toEqual(
        [
          { directory: AbsolutePath.make(tmp), strategy: undefined },
          { directory: AbsolutePath.make(clone), strategy: undefined },
        ].toSorted((a, b) => a.directory.localeCompare(b.directory)),
      )
    }),
  )

  it.live("stores only the materialized worktree for a bare repository", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const bare = tmp + "-project-directory-bare-store.git"
      const worktree = tmp + "-project-directory-bare-worktree"
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => $`rm -rf ${bare} ${worktree}`.quiet().nothrow()).pipe(Effect.ignore),
      )
      yield* Effect.promise(() => $`git clone --bare ${tmp} ${bare}`.quiet())
      yield* Effect.promise(() => $`git worktree add ${worktree} HEAD`.cwd(bare).quiet())
      const project = yield* Project.Service

      const result = yield* project.fromDirectory(worktree)

      expect(yield* directories(result.project.id)).toEqual([
        { directory: AbsolutePath.make(worktree), strategy: undefined },
      ])
    }),
  )

  it.live("records the active directory under its newly resolved project id", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const project = yield* Project.Service
      yield* project.fromDirectory(tmp)
      const remoteID = ProjectV2.ID.make(Hash.fast("git-remote:github.com/project-directory-test/collision"))
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({
          id: remoteID,
          worktree: AbsolutePath.make("/tmp/existing"),
          vcs: "git",
          time_created: Date.now(),
          time_updated: Date.now(),
          sandboxes: [],
        })
        .run()
        .pipe(Effect.orDie)
      yield* Effect.promise(() =>
        $`git remote add origin git@github.com:project-directory-test/collision.git`.cwd(tmp).quiet(),
      )

      yield* project.fromDirectory(tmp)

      expect(yield* directories(remoteID)).toEqual([{ directory: AbsolutePath.make(tmp), strategy: undefined }])
    }),
  )

  it.live("clears stale directories when the project id changes", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const project = yield* Project.Service
      const original = yield* project.fromDirectory(tmp)
      const stale = AbsolutePath.make(tmp + "-stale-checkout")
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectDirectoryTable)
        .values({ project_id: original.project.id, directory: stale })
        .run()
        .pipe(Effect.orDie)
      const remoteID = ProjectV2.ID.make(Hash.fast("git-remote:github.com/project-directory-test/migration"))
      yield* Effect.promise(() =>
        $`git remote add origin git@github.com:project-directory-test/migration.git`.cwd(tmp).quiet(),
      )

      yield* project.fromDirectory(tmp)

      expect(yield* directories(original.project.id)).toEqual([])
      expect(yield* directories(remoteID)).toEqual([{ directory: AbsolutePath.make(tmp), strategy: undefined }])
    }),
  )
})
