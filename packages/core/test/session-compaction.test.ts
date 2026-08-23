import { expect, test } from "bun:test"
import { SessionCompaction } from "@hena/core/session/compaction"
import { Database } from "@hena/core/database/database"
import { AppNodeBuilder } from "@hena/core/effect/app-node-builder"
import { LayerNode } from "@hena/core/effect/layer-node"
import { EventV2 } from "@hena/core/event"
import { SessionEvent } from "@hena/core/session/event"
import { SessionMessage } from "@hena/core/session/message"
import { SessionV2 } from "@hena/core/session"
import { LLM, LLMEvent, Model } from "@hena/llm"
import { route } from "@hena/llm/protocols/openai-chat"
import { DateTime, Effect, Stream } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node])))

test("compaction prompt preserves detailed work state and relevant files", () => {
  const prompt = SessionCompaction.buildPrompt({ context: ["conversation history"] })

  expect(prompt).toContain("## Work State\n### Completed")
  expect(prompt).toContain("### Active")
  expect(prompt).toContain("### Blocked")
  expect(prompt).toContain("## Relevant Files")
})

test("compaction describes tool media without embedding base64", () => {
  const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
  const serialized = SessionCompaction.serializeToolContent([
    { type: "text", text: "Image read successfully" },
    {
      type: "file",
      uri: `data:image/png;base64,${base64}`,
      mime: "image/png",
      name: "pixel.png",
    },
  ])

  expect(serialized).toBe("Image read successfully\n[Attached image/png: pixel.png]")
  expect(serialized).not.toContain(base64)
})

it.effect("automatic compaction publishes text deltas", () =>
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const observed: Array<{ type: string; data: unknown }> = []
    const unsubscribe = yield* events.listen((event) => Effect.sync(() => observed.push(event)))
    const model = Model.make({
      id: "compact",
      provider: "test",
      route: route.with({ limits: { context: 100_000, output: 4_096 } }),
    })
    const compact = SessionCompaction.make({
      events,
      llm: {
        stream: () => Stream.fromIterable([
          LLMEvent.textDelta({ id: "summary", text: "first" }),
          LLMEvent.textDelta({ id: "summary", text: " second" }),
        ]),
      },
      config: [],
    })

    expect(yield* compact.compactAfterOverflow({
      sessionID: SessionV2.ID.make("ses_compaction_delta"),
      entries: [{
        seq: 0,
        message: SessionMessage.User.make({
          id: SessionMessage.ID.make("msg_user"),
          type: "user",
          text: "x".repeat(40_000),
          time: { created: DateTime.makeUnsafe(1) },
        }),
      }],
      model,
      request: LLM.request({ model, messages: [], tools: [] }),
    })).toBe(true)
    yield* unsubscribe

    expect(observed.filter((event) => event.type === SessionEvent.Compaction.Delta.type).map((event) => event.data))
      .toEqual([
        expect.objectContaining({ text: "first" }),
        expect.objectContaining({ text: " second" }),
      ])
  }),
)
