import { $ } from "bun"
import { expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@hena/core/effect/app-node-builder"
import { LayerNode } from "@hena/core/effect/layer-node"
import { Global } from "@hena/core/global"
import { Location } from "@hena/core/location"
import { AbsolutePath } from "@hena/core/schema"
import { SessionV2 } from "@hena/core/session"
import { SessionExecution } from "@hena/core/session/execution"
import { SessionProjector } from "@hena/core/session/projector"
import { SessionEvent } from "@hena/core/session/event"
import { EventV2 } from "@hena/core/event"
import { Snapshot } from "@hena/core/snapshot"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

testEffect(Layer.empty).live("restores files when switching a staged file revert to transcript-only", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    )
    const directory = AbsolutePath.make(path.join(tmp.path, "project"))
    const file = path.join(directory, "note.txt")
    yield* Effect.promise(async () => {
      await fs.mkdir(directory)
      await fs.writeFile(file, "original\n")
      await $`git init`.cwd(directory).quiet()
      await $`git -c core.fsmonitor=false add .`.cwd(directory).quiet()
      await $`git -c commit.gpgsign=false -c user.email=test@hena.test -c user.name=Test commit -m initial`
        .cwd(directory)
        .quiet()
    })
    const location = Location.Ref.make({ directory })
    yield* Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const snapshots = yield* Snapshot.Service
      const session = yield* sessions.create({ location })
      const boundary = yield* sessions.prompt({ sessionID: session.id, prompt: { text: "edit" }, resume: false })
      yield* events.publish(SessionEvent.Prompted, {
        sessionID: session.id,
        messageID: boundary.id,
        prompt: boundary.prompt,
        delivery: boundary.delivery,
        timestamp: boundary.timeCreated,
      })
      const original = yield* snapshots.capture()
      expect(original).toBeDefined()
      if (!original) return
      yield* Effect.promise(() => fs.writeFile(file, "edited\n"))
      const edited = yield* snapshots.capture()
      expect(edited).toBeDefined()
      if (!edited) return
      const files = yield* snapshots.diff({ from: edited, to: original })
      yield* snapshots.checkout(original)
      yield* events.publish(SessionEvent.RevertEvent.Staged, {
        sessionID: session.id,
        timestamp: boundary.timeCreated,
        revert: { messageID: boundary.id, snapshot: edited, files },
      })
      expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe("original\n")
      yield* sessions.revert.stage({ sessionID: session.id, messageID: boundary.id, files: false })
      expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe("edited\n")
      expect((yield* sessions.get(session.id)).revert).toEqual({ messageID: boundary.id })
      yield* sessions.revert.clear(session.id)
      expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe("edited\n")
    }).pipe(
      Effect.provide(
        AppNodeBuilder.build(LayerNode.group([SessionV2.node, SessionProjector.node, EventV2.node, Snapshot.node]), [
          [Location.node, Location.boundNode(location)],
          [Global.node, Global.layerWith({ data: path.join(tmp.path, "data"), config: path.join(tmp.path, "config") })],
          [SessionExecution.node, SessionExecution.noopLayer],
        ]),
      ),
    )
  }),
)
