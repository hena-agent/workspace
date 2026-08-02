import { describe, expect } from "bun:test"
import { LayerNode } from "@hena/core/effect/layer-node"
import { ProjectV2 } from "@hena/core/project"
import { Effect, Fiber, Layer, Queue } from "effect"
import { Agent } from "@/agent/agent"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Question } from "@/question"
import { MessageID, SessionID } from "@/session/schema"
import { AttachFolderTool } from "@/tool/attach-folder"
import { Truncate } from "@/tool/truncate"
import { testEffect } from "../lib/effect"

const context = {
  sessionID: SessionID.make("ses_attach-folder-test"),
  messageID: MessageID.make("msg_attach-folder-test"),
  callID: "call-attach-folder-test",
  agent: "test-agent",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const it = testEffect(
  LayerNode.compile(LayerNode.group([Question.node, EventV2Bridge.node, Truncate.node, Agent.node, ProjectV2.node]), [
    [
      ProjectV2.node,
      Layer.mock(ProjectV2.Service, {
        isFolderless: () => Effect.succeed(false),
      }),
    ],
  ]),
)

describe("tool.attach_folder", () => {
  it.instance("emits an attach action and waits for the App", () =>
    Effect.gen(function* () {
      const question = yield* Question.Service
      const tool = yield* (yield* AttachFolderTool).init()
      const asked = yield* Queue.unbounded<void>()
      const off = yield* (yield* EventV2Bridge.Service).listen((event) => {
        if (event.type === Question.Event.Asked.type) Queue.offerUnsafe(asked, undefined)
        return Effect.void
      })
      yield* Effect.addFinalizer(() => off)

      const fiber = yield* tool.execute({ reason: "I need the source files" }, context).pipe(Effect.forkScoped)
      const request = yield* Effect.gen(function* () {
        for (;;) {
          const item = (yield* question.list())[0]
          if (item) return item
          yield* Queue.take(asked).pipe(Effect.timeout("2 seconds"))
        }
      })

      expect(request.action).toMatchObject({
        type: "attach-folder",
      })
      yield* question.reply({ requestID: request.id, answers: [["not a status sentinel"]] })
      expect((yield* Fiber.join(fiber)).output).toContain("Stop now")
    }),
  )
})
