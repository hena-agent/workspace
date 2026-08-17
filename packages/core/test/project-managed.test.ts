import { afterAll, describe, expect } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@hena/core/effect/app-node-builder"
import { LayerNode } from "@hena/core/effect/layer-node"
import { Global } from "@hena/core/global"
import { Project } from "@hena/core/project"
import { AbsolutePath } from "@hena/core/schema"
import { testEffect } from "./lib/effect"

const data = await fs.mkdtemp(path.join(os.tmpdir(), "hena-managed-project-"))
const projectsRoot = path.join(data, "projects")
afterAll(() => fs.rm(data, { recursive: true, force: true }))

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Project.node, Global.node]), [
    [Global.node, Global.layerWith({ data, projects: projectsRoot })],
  ]),
)

describe("managed projects", () => {
  it.live("creates a private directory and resolves nested paths", () =>
    Effect.gen(function* () {
      const projects = yield* Project.Service
      const created = yield* projects.create()
      const child = AbsolutePath.make(path.join(created.directory, "notes"))
      yield* Effect.promise(() => fs.mkdir(child))
      const root = AbsolutePath.make(path.dirname(created.directory))
      const outside = AbsolutePath.make(path.join(data, "projects-other", created.id))
      const unmanaged = AbsolutePath.make(path.join(projectsRoot, "notes"))
      yield* Effect.promise(() => fs.mkdir(outside, { recursive: true }))
      yield* Effect.promise(() => fs.mkdir(unmanaged))

      expect(Project.ID.isManaged(created.id)).toBe(true)
      expect(created.directory).toBe(AbsolutePath.make(path.join(root, created.id)))
      expect(yield* projects.resolve(child)).toEqual(created)
      expect((yield* projects.resolve(outside)).id).toBe(Project.ID.global)
      expect((yield* projects.resolve(unmanaged)).id).toBe(Project.ID.global)

      if (process.platform !== "win32") {
        expect((yield* Effect.promise(() => fs.stat(root))).mode & 0o777).toBe(0o700)
        expect((yield* Effect.promise(() => fs.stat(created.directory))).mode & 0o777).toBe(0o700)
      }
    }),
  )

  it.live("keeps managed identity when a directory becomes a git repository", () =>
    Effect.gen(function* () {
      const projects = yield* Project.Service
      yield* Effect.promise(() => $`git init`.cwd(data).quiet())
      const created = yield* projects.create()

      expect((yield* projects.resolve(created.directory)).vcs).toBeUndefined()

      yield* Effect.promise(() => $`git init`.cwd(created.directory).quiet())
      expect(yield* projects.resolve(created.directory)).toMatchObject({
        id: created.id,
        directory: created.directory,
        vcs: { type: "git" },
      })

      yield* Effect.promise(() =>
        $`git -c user.name=Test -c user.email=test@hena.test commit --allow-empty -m root`
          .cwd(created.directory)
          .quiet(),
      )
      const linked = path.join(data, `linked-${created.id}`)
      yield* Effect.addFinalizer(() => Effect.promise(() => fs.rm(linked, { recursive: true, force: true })))
      yield* Effect.promise(() => $`git worktree add ${linked} -b linked-${created.id}`.cwd(created.directory).quiet())
      const linkedDirectory = AbsolutePath.make(yield* Effect.promise(() => fs.realpath(linked)))
      expect(yield* projects.resolve(AbsolutePath.make(linked))).toMatchObject({
        id: created.id,
        directory: linkedDirectory,
        vcs: { type: "git" },
      })

      const nested = path.join(created.directory, "nested")
      yield* Effect.promise(() => fs.mkdir(nested))
      yield* Effect.promise(() => $`git init`.cwd(nested).quiet())
      expect(yield* projects.resolve(AbsolutePath.make(nested))).toMatchObject({
        id: created.id,
        directory: created.directory,
        vcs: { type: "git", store: AbsolutePath.make(path.join(created.directory, ".git")) },
      })
    }),
  )
})
