import { afterAll, describe, expect } from "bun:test"
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
afterAll(() => fs.rm(data, { recursive: true, force: true }))

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Project.node, Global.node]), [[Global.node, Global.layerWith({ data })]]),
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
      yield* Effect.promise(() => fs.mkdir(outside, { recursive: true }))

      expect(Global.make({ data }).projects).toBe(path.join(data, "projects"))
      expect(String(created.id)).toMatch(/^prj_[0-9A-Za-z]+$/)
      expect(created.directory).toBe(AbsolutePath.make(path.join(root, created.id)))
      expect(yield* projects.resolve(child)).toEqual(created)
      expect((yield* projects.resolve(outside)).id).toBe(Project.ID.global)

      if (process.platform !== "win32") {
        expect((yield* Effect.promise(() => fs.stat(root))).mode & 0o777).toBe(0o700)
        expect((yield* Effect.promise(() => fs.stat(created.directory))).mode & 0o777).toBe(0o700)
      }
    }),
  )
})
