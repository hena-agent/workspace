import { describe, expect } from "bun:test"
import { DateTime, Effect, Fiber, Layer, Stream } from "effect"
import { asc, eq, sql } from "drizzle-orm"
import { Database } from "@hena/core/database/database"
import { AppNodeBuilder } from "@hena/core/effect/app-node-builder"
import { LayerNode } from "@hena/core/effect/layer-node"
import { EventV2 } from "@hena/core/event"
import { EventTable } from "@hena/core/event/sql"
import { SessionEvent } from "@hena/core/session/event"
import { Project } from "@hena/core/project"
import { ProjectTable } from "@hena/core/project/sql"
import { AbsolutePath } from "@hena/core/schema"
import { SessionV2 } from "@hena/core/session"
import { Prompt } from "@hena/core/session/prompt"
import { SessionMessage } from "@hena/core/session/message"
import { SessionProjector } from "@hena/core/session/projector"
import { SessionExecution } from "@hena/core/session/execution"
import { SessionInput } from "@hena/core/session/input"
import { SessionInputTable, SessionMessageTable, SessionTable } from "@hena/core/session/sql"
import { SessionStore } from "@hena/core/session/store"
import { testEffect } from "./lib/effect"

const executionCalls: SessionV2.ID[] = []
const interruptCalls: SessionV2.ID[] = []
const wakeCalls: SessionV2.ID[] = []
const activeSessions = new Set<SessionV2.ID>()
const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.sync(() => new Set(activeSessions)),
    resume: (sessionID) =>
      Effect.sync(() => {
        executionCalls.push(sessionID)
      }),
    interrupt: (sessionID) =>
      Effect.sync(() => {
        interruptCalls.push(sessionID)
      }),
    wake: (sessionID) =>
      Effect.sync(() => {
        wakeCalls.push(sessionID)
      }),
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [[SessionExecution.node, execution]],
  ),
)
const sessionID = SessionV2.ID.make("ses_prompt_test")
const messageID = SessionMessage.ID.create()

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "test",
      directory: "/project",
      title: "test",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

const admitted = (id: SessionMessage.ID) => Database.Service.use(({ db }) => SessionInput.find(db, id))
const admittedCount = Database.Service.use(({ db }) =>
  db
    .select()
    .from(SessionInputTable)
    .all()
    .pipe(
      Effect.orDie,
      Effect.map((rows) => rows.length),
    ),
)
const eventCount = (type: string) =>
  Database.Service.use(({ db }) =>
    db
      .select()
      .from(EventTable)
      .where(eq(EventTable.type, type))
      .all()
      .pipe(
        Effect.orDie,
        Effect.map((rows) => rows.length),
      ),
  )

describe("SessionV2.prompt", () => {
  it.effect("uses admission order when rollback-created queue positions tie", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const first = SessionMessage.ID.make("msg_rollback_first")
      const second = SessionMessage.ID.make("msg_rollback_second")
      yield* db
        .insert(SessionInputTable)
        .values([
          {
            id: second,
            session_id: sessionID,
            prompt: Prompt.make({ text: "second" }),
            delivery: "queue",
            admitted_seq: 2,
            queue_position: 0,
          },
          {
            id: first,
            session_id: sessionID,
            prompt: Prompt.make({ text: "first" }),
            delivery: "queue",
            admitted_seq: 1,
            queue_position: 0,
          },
        ])
        .run()
        .pipe(Effect.orDie)

      expect(yield* SessionInput.promoteNextQueued(db, events, sessionID)).toBe(true)
      expect(yield* admitted(first)).toMatchObject({ id: first, promotedSeq: 0 })
      expect((yield* admitted(second))?.promotedSeq).toBeUndefined()
    }),
  )

  it.effect("keeps rollback-created inputs ahead of newer inputs", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const first = SessionMessage.ID.make("msg_before_rollback")
      const rollback = SessionMessage.ID.make("msg_from_rollback")
      const newer = SessionMessage.ID.make("msg_after_upgrade")
      yield* db
        .insert(SessionInputTable)
        .values([
          {
            id: first,
            session_id: sessionID,
            prompt: Prompt.make({ text: "first" }),
            delivery: "queue",
            admitted_seq: 1,
            queue_position: 1,
          },
          {
            id: rollback,
            session_id: sessionID,
            prompt: Prompt.make({ text: "rollback" }),
            delivery: "queue",
            admitted_seq: 2,
          },
        ])
        .run()
        .pipe(Effect.orDie)
      expect(
        yield* db
          .select({ queuePosition: SessionInputTable.queue_position })
          .from(SessionInputTable)
          .where(eq(SessionInputTable.id, rollback))
          .get()
          .pipe(Effect.orDie),
      ).toEqual({ queuePosition: Number.MAX_SAFE_INTEGER })
      yield* SessionInput.normalizeQueuePositions(db)
      expect(
        yield* db
          .select({ queuePosition: SessionInputTable.queue_position })
          .from(SessionInputTable)
          .where(eq(SessionInputTable.id, rollback))
          .get()
          .pipe(Effect.orDie),
      ).toEqual({ queuePosition: 2 })
      yield* db
        .insert(SessionInputTable)
        .values({
          id: newer,
          session_id: sessionID,
          prompt: Prompt.make({ text: "newer" }),
          delivery: "queue",
          admitted_seq: 3,
          queue_position: 3,
        })
        .run()
        .pipe(Effect.orDie)

      expect(yield* SessionInput.promoteNextQueued(db, events, sessionID)).toBe(true)
      expect(yield* SessionInput.promoteNextQueued(db, events, sessionID)).toBe(true)
      expect(yield* SessionInput.promoteNextQueued(db, events, sessionID)).toBe(true)
      expect(
        (yield* db
          .select({ id: SessionInputTable.id })
          .from(SessionInputTable)
          .orderBy(asc(SessionInputTable.promoted_seq))
          .all()
          .pipe(Effect.orDie)).map((row) => row.id),
      ).toEqual([first, rollback, newer])
    }),
  )

  it.effect("reorders and cancels pending queue inputs with revisions", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const first = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "first" }),
        delivery: "queue",
        resume: false,
      })
      const second = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "second" }),
        delivery: "queue",
        resume: false,
      })

      expect((yield* session.get(sessionID)).queueRevision).toBe(2)
      expect(
        yield* session.reorderInputs({
          sessionID,
          messageIDs: [second.id, first.id],
          expectedRevision: 2,
        }),
      ).toBe(3)
      const { db } = yield* Database.Service
      expect(
        (yield* db
          .select({ id: SessionInputTable.id })
          .from(SessionInputTable)
          .orderBy(asc(SessionInputTable.queue_position))
          .all()
          .pipe(Effect.orDie)).map((row) => row.id),
      ).toEqual([second.id, first.id])
      expect(yield* session.cancelInput({ sessionID, messageID: first.id, expectedRevision: 3 })).toBe(4)
      expect(yield* admitted(first.id)).toBeUndefined()

      const events = yield* EventV2.Service
      const defect = yield* events
        .publish(SessionEvent.InputCanceled, {
          sessionID,
          messageID: second.id,
          expectedRevision: 3,
          timestamp: yield* DateTime.now,
        })
        .pipe(Effect.catchDefect(Effect.succeed))
      expect(defect).toBeInstanceOf(SessionV2.QueueRevisionConflictError)
      expect(defect).toMatchObject({ expected: 3, actual: 4, messageIDs: [second.id] })
      expect(
        yield* db.get<{ count: number }>(sql`
          SELECT COUNT(*) AS count FROM event
          WHERE type IN ('session.next.input.canceled.1', 'session.next.input.reordered.1')
        `),
      ).toEqual({ count: 2 })

      const conflict = yield* session
        .cancelInput({
          sessionID,
          messageID: second.id,
          expectedRevision: 3,
        })
        .pipe(Effect.flip)
      expect(conflict).toBeInstanceOf(SessionV2.QueueRevisionConflictError)
      expect(conflict).toMatchObject({ expected: 3, actual: 4, messageIDs: [second.id] })

      const canceled = yield* session
        .cancelInput({ sessionID, messageID: first.id, expectedRevision: 4 })
        .pipe(Effect.flip)
      expect(canceled).toMatchObject({
        _tag: "Session.QueueStateConflictError",
        revision: 4,
        messageIDs: [second.id],
      })

      const reordered = yield* session
        .reorderInputs({ sessionID, messageIDs: [], expectedRevision: 4 })
        .pipe(Effect.flip)
      expect(reordered).toMatchObject({
        _tag: "Session.QueueStateConflictError",
        revision: 4,
        messageIDs: [second.id],
      })
    }),
  )

  it.effect("exposes the execution registry", () =>
    Effect.gen(function* () {
      activeSessions.add(sessionID)
      expect(Array.from(yield* (yield* SessionV2.Service).active)).toEqual([sessionID])
    }).pipe(Effect.ensuring(Effect.sync(() => activeSessions.clear()))),
  )

  it.effect("delegates execution continuation through SessionExecution", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      executionCalls.length = 0
      wakeCalls.length = 0
      yield* session.resume(sessionID)
      expect(executionCalls).toEqual([sessionID])
      expect(wakeCalls).toEqual([])
    }),
  )

  it.effect("delegates process-local interruption through SessionExecution", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      interruptCalls.length = 0

      yield* session.interrupt(sessionID)
      expect(interruptCalls).toEqual([sessionID])
      expect(yield* session.messages({ sessionID })).toEqual([])
    }),
  )

  it.effect("delegates interruption without requiring a recorded Session", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      interruptCalls.length = 0

      yield* session.interrupt(SessionV2.ID.make("ses_missing"))
      expect(interruptCalls).toEqual([SessionV2.ID.make("ses_missing")])
    }),
  )

  it.effect("durably admits one user message before transcript promotion", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service

      const message = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Fix the failing tests" }),
        resume: false,
      })

      expect(message.prompt.text).toBe("Fix the failing tests")
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admitted(message.id)).toMatchObject({
        id: message.id,
        sessionID,
        prompt: { text: "Fix the failing tests" },
        delivery: "steer",
      })
    }),
  )

  it.effect("resolves attachment MIME before admission", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service

      const message = yield* session.prompt({
        sessionID,
        prompt: {
          text: "Inspect this image",
          files: [{ uri: "data:image/png;base64,aGVsbG8=", name: "image.png" }],
        },
        resume: false,
      })

      expect(message.prompt.files).toEqual([
        { uri: "data:image/png;base64,aGVsbG8=", name: "image.png", mime: "image/png" },
      ])
      expect((yield* admitted(message.id))?.prompt.files).toEqual(message.prompt.files)
    }),
  )

  it.effect("streams durable Session events after an aggregate sequence", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const fiber = yield* session.events({ sessionID }).pipe(Stream.take(4), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "First" }), resume: false })
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Second" }), resume: false })
      yield* SessionInput.promoteSteers(db, events, sessionID, Number.MAX_SAFE_INTEGER)
      const streamed = Array.from(yield* Fiber.join(fiber))

      expect(streamed.map((event) => [event.durable?.seq, event.type])).toEqual([
        [0, "session.next.prompt.admitted"],
        [1, "session.next.prompt.admitted"],
        [2, "session.next.prompted"],
        [3, "session.next.prompted"],
      ])
      expect(
        Array.from(
          yield* session
            .events({ sessionID, after: streamed[0]!.durable?.seq })
            .pipe(Stream.take(1), Stream.runCollect),
        ).map((event) => [event.durable?.seq, event.type]),
      ).toEqual([[1, "session.next.prompt.admitted"]])
    }),
  )

  it.effect("resumes through a recorded message without appending another prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const message = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Fix the failing tests" }),
        resume: false,
      })

      executionCalls.length = 0
      wakeCalls.length = 0
      yield* session.resume(sessionID)

      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admitted(message.id)).not.toHaveProperty("promotedSeq")
      expect(executionCalls).toEqual([sessionID])
      expect(wakeCalls).toEqual([])
    }),
  )

  it.effect("records distinct messages when the ID is omitted", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const input = { sessionID, prompt: Prompt.make({ text: "Fix the failing tests" }), resume: false }

      const first = yield* session.prompt(input)
      const second = yield* session.prompt(input)

      expect(second.id).not.toBe(first.id)
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admittedCount).toBe(2)
    }),
  )

  it.effect("returns the original recorded message when the ID is retried", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const input = {
        sessionID,
        id: messageID,
        prompt: Prompt.make({ text: "Fix the failing tests" }),
        resume: false,
      }

      const first = yield* session.prompt(input)
      const retried = yield* session.prompt(input)

      expect(retried).toEqual(first)
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admittedCount).toBe(1)
    }),
  )

  it.effect("wakes execution when an exact prompt retry recovers a committed message", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const input = {
        sessionID,
        id: messageID,
        prompt: Prompt.make({ text: "Recover committed prompt" }),
        resume: false,
      }
      const first = yield* session.prompt(input)
      wakeCalls.length = 0

      const retried = yield* session.prompt({ ...input, resume: true })

      expect(retried).toEqual(first)
      expect(wakeCalls).toEqual([sessionID])
    }),
  )

  it.effect("rejects reuse of one ID with a different prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service

      yield* session.prompt({
        sessionID,
        id: messageID,
        prompt: Prompt.make({ text: "Fix the failing tests" }),
      })
      const failure = yield* session
        .prompt({
          sessionID,
          id: messageID,
          prompt: Prompt.make({ text: "Delete the failing tests" }),
          resume: false,
        })
        .pipe(Effect.flip)

      expect(failure._tag).toBe("Session.PromptConflictError")
      expect(yield* session.messages({ sessionID })).toHaveLength(0)
      expect(yield* admittedCount).toBe(1)
    }),
  )

  it.effect("rejects reuse of one ID with a different delivery mode", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service

      yield* session.prompt({
        id: messageID,
        sessionID,
        prompt: Prompt.make({ text: "Fix the failing tests" }),
        resume: false,
      })
      const failure = yield* session
        .prompt({
          id: messageID,
          sessionID,
          prompt: Prompt.make({ text: "Fix the failing tests" }),
          delivery: "queue",
          resume: false,
        })
        .pipe(Effect.flip)

      expect(failure._tag).toBe("Session.PromptConflictError")
    }),
  )

  it.effect("reconciles canceled prompt IDs only for exact retries", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const original = yield* session.prompt({
        id: messageID,
        sessionID,
        prompt: Prompt.make({ text: "Original" }),
        delivery: "queue",
        resume: false,
      })
      yield* session.cancelInput({ sessionID, messageID, expectedRevision: 1 })

      expect(
        yield* session.prompt({
          id: messageID,
          sessionID,
          prompt: Prompt.make({ text: "Original" }),
          delivery: "queue",
          resume: false,
        }),
      ).toEqual(original)
      const conflict = yield* session
        .prompt({
          id: messageID,
          sessionID,
          prompt: Prompt.make({ text: "Different" }),
          delivery: "queue",
          resume: false,
        })
        .pipe(Effect.flip)

      expect(conflict._tag).toBe("Session.PromptConflictError")
      expect(yield* admitted(messageID)).toBeUndefined()
      expect(yield* eventCount(EventV2.versionedType(SessionEvent.PromptAdmitted.type, 1))).toBe(1)
      const { db } = yield* Database.Service
      const plan = yield* db.all<{ detail: string }>(sql`
        EXPLAIN QUERY PLAN SELECT seq, data FROM event
        WHERE type = ${EventV2.versionedType(SessionEvent.PromptAdmitted.type, 1)}
          AND json_extract(data, '$.messageID') = ${messageID}
      `)
      expect(plan.some((row) => row.detail.includes("event_type_message_id_idx"))).toBe(true)
    }),
  )

  it.effect("returns one recorded message to concurrent exact retries", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const input = {
        sessionID,
        id: messageID,
        prompt: Prompt.make({ text: "Fix the failing tests" }),
        resume: false,
      }

      const messages = yield* Effect.all([session.prompt(input), session.prompt(input)], { concurrency: "unbounded" })

      expect(messages[1]).toEqual(messages[0])
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admittedCount).toBe(1)
      expect(yield* eventCount(EventV2.versionedType(SessionEvent.PromptAdmitted.type, 1))).toBe(1)
    }),
  )

  it.effect("promotes one message once under concurrent promotion attempts", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      yield* session.prompt({ id: messageID, sessionID, prompt: Prompt.make({ text: "Promote once" }), resume: false })

      yield* Effect.all(
        [
          SessionInput.promoteSteers(db, events, sessionID, Number.MAX_SAFE_INTEGER),
          SessionInput.promoteSteers(db, events, sessionID, Number.MAX_SAFE_INTEGER),
        ],
        { concurrency: "unbounded" },
      )

      expect(yield* eventCount(EventV2.versionedType(SessionEvent.Prompted.type, 1))).toBe(1)
      expect(yield* admitted(messageID)).toMatchObject({ promotedSeq: 1 })
      expect(yield* session.messages({ sessionID })).toMatchObject([
        { id: messageID, type: "user", text: "Promote once" },
      ])
    }),
  )

  it.effect("does not promote an input canceled after queue selection", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const input = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Cancel during promotion" }),
        delivery: "queue",
        resume: false,
      })
      const racingEvents = EventV2.Service.of({
        ...events,
        publish: (definition, data, options) =>
          Effect.gen(function* () {
            if (definition.type === SessionEvent.Prompted.type)
              yield* events.publish(SessionEvent.InputCanceled, {
                sessionID,
                messageID: input.id,
                expectedRevision: 1,
                timestamp: yield* DateTime.now,
              })
            return yield* events.publish(definition, data, options)
          }),
      })

      expect(yield* SessionInput.promoteNextQueued(db, racingEvents, sessionID)).toBe(false)
      expect(yield* admitted(input.id)).toBeUndefined()
      expect(yield* session.messages({ sessionID })).toEqual([])
    }),
  )

  it.effect("promotes the reordered first input when ordering changes after selection", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const first = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "First before reorder" }),
        delivery: "queue",
        resume: false,
      })
      const second = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "First after reorder" }),
        delivery: "queue",
        resume: false,
      })
      const state = { reordered: false }
      const racingEvents = EventV2.Service.of({
        ...events,
        publish: (definition, data, options) =>
          Effect.gen(function* () {
            if (definition.type === SessionEvent.Prompted.type && !state.reordered) {
              state.reordered = true
              yield* events.publish(SessionEvent.InputReordered, {
                sessionID,
                messageIDs: [second.id, first.id],
                expectedRevision: 2,
                timestamp: yield* DateTime.now,
              })
            }
            return yield* events.publish(definition, data, options)
          }),
      })

      expect(yield* SessionInput.promoteNextQueued(db, racingEvents, sessionID)).toBe(true)
      expect(yield* admitted(first.id)).not.toHaveProperty("promotedSeq")
      expect(yield* admitted(second.id)).toHaveProperty("promotedSeq")
      expect(yield* session.messages({ sessionID })).toMatchObject([
        { id: second.id, type: "user", text: "First after reorder" },
      ])
    }),
  )

  it.effect("counts steers promoted before a later selected input is canceled", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const first = yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Promote" }), resume: false })
      const second = yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Cancel" }), resume: false })
      const state = { prompted: 0 }
      const racingEvents = EventV2.Service.of({
        ...events,
        publish: (definition, data, options) =>
          Effect.gen(function* () {
            if (definition.type === SessionEvent.Prompted.type) state.prompted++
            if (definition.type === SessionEvent.Prompted.type && state.prompted === 2)
              yield* events.publish(SessionEvent.InputCanceled, {
                sessionID,
                messageID: second.id,
                expectedRevision: 3,
                timestamp: yield* DateTime.now,
              })
            return yield* events.publish(definition, data, options)
          }),
      })

      expect(yield* SessionInput.promoteSteers(db, racingEvents, sessionID, Number.MAX_SAFE_INTEGER)).toBe(1)
      expect(yield* admitted(first.id)).toHaveProperty("promotedSeq")
      expect(yield* admitted(second.id)).toBeUndefined()
    }),
  )

  it.effect("promotes steers only through the captured inbox cutoff", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const first = yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Before cutoff" }), resume: false })
      const cutoff = first.admittedSeq
      const second = yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "After cutoff" }), resume: false })

      yield* SessionInput.promoteSteers(db, events, sessionID, cutoff)

      expect(yield* admitted(first.id)).toHaveProperty("promotedSeq")
      expect(yield* admitted(second.id)).not.toHaveProperty("promotedSeq")
    }),
  )

  it.effect("reprojects pending inbox input without scheduling execution", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      wakeCalls.length = 0
      yield* session.prompt({
        id: messageID,
        sessionID,
        prompt: Prompt.make({ text: "Replay pending" }),
        resume: false,
      })
      const recorded = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .all()
        .pipe(Effect.orDie)

      yield* events.remove(sessionID)
      yield* db.delete(SessionInputTable).where(eq(SessionInputTable.session_id, sessionID)).run().pipe(Effect.orDie)
      yield* db
        .delete(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, sessionID))
        .run()
        .pipe(Effect.orDie)
      yield* events.replayAll(
        recorded.map((event) => ({
          id: event.id,
          aggregateID: event.aggregate_id,
          seq: event.seq,
          type: event.type,
          data: event.data,
        })),
      )

      expect(yield* admitted(messageID)).toMatchObject({ id: messageID, prompt: { text: "Replay pending" } })
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(wakeCalls).toEqual([])
    }),
  )

  it.effect("returns an exact retry of a legacy projected prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const prompt = Prompt.make({ text: "Historical prompt" })
      yield* events.publish(SessionEvent.Prompted, {
        sessionID,
        messageID,
        timestamp: yield* DateTime.now,
        prompt,
        delivery: "steer",
      })

      const retried = yield* session.prompt({ id: messageID, sessionID, prompt, resume: false })

      expect(retried).toMatchObject({ id: messageID, prompt: { text: "Historical prompt" } })
      expect(yield* admitted(messageID)).toHaveProperty("promotedSeq")
    }),
  )

  it.effect("returns an exact retry of a legacy projected queued prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const prompt = Prompt.make({ text: "Historical queued prompt" })
      yield* events.publish(SessionEvent.Prompted, {
        sessionID,
        messageID,
        timestamp: yield* DateTime.now,
        prompt,
        delivery: "queue",
      })

      const retried = yield* session.prompt({ id: messageID, sessionID, prompt, delivery: "queue", resume: false })

      expect(retried).toMatchObject({ id: messageID, prompt: { text: "Historical queued prompt" } })
      expect(yield* admitted(messageID)).toMatchObject({ delivery: "queue" })
    }),
  )

  it.effect("rejects reuse of one globally unique message ID across sessions", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const session = yield* SessionV2.Service
      const other = SessionV2.ID.make("ses_prompt_other")
      yield* db
        .insert(SessionTable)
        .values({
          id: other,
          project_id: Project.ID.global,
          slug: "other",
          directory: "/project",
          title: "other",
          version: "test",
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      const prompt = Prompt.make({ text: "Fix the failing tests" })

      yield* session.prompt({ id: messageID, sessionID, prompt, resume: false })
      const failure = yield* session
        .prompt({ id: messageID, sessionID: other, prompt, resume: false })
        .pipe(Effect.flip)

      expect(failure).toMatchObject({ _tag: "Session.PromptConflictError", sessionID: other, messageID })
    }),
  )

  it.effect("rejects a prompt ID already used by visible Session history", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      yield* events.publish(SessionEvent.Synthetic, {
        sessionID,
        messageID,
        timestamp: yield* DateTime.now,
        text: "Existing history",
      })

      const failure = yield* session
        .prompt({ id: messageID, sessionID, prompt: Prompt.make({ text: "Conflicting prompt" }), resume: false })
        .pipe(Effect.flip)

      expect(failure).toMatchObject({ _tag: "Session.PromptConflictError", sessionID, messageID })
      expect(yield* admitted(messageID)).toBeUndefined()
    }),
  )

  it.effect("starts execution by default after recording the prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      executionCalls.length = 0
      wakeCalls.length = 0

      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Run by default" }) })

      expect(executionCalls).toEqual([])
      expect(wakeCalls).toEqual([sessionID])
    }),
  )

  it.effect("starts execution when resume is explicitly true", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      executionCalls.length = 0
      wakeCalls.length = 0

      yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Run explicitly" }),
        resume: true,
      })

      expect(executionCalls).toEqual([])
      expect(wakeCalls).toEqual([sessionID])
    }),
  )

  it.effect("only records the prompt when resume is false", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      executionCalls.length = 0
      wakeCalls.length = 0

      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Do not run" }), resume: false })

      expect(executionCalls).toEqual([])
      expect(wakeCalls).toEqual([])
    }),
  )
})
