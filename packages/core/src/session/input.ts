export * as SessionInput from "./input"

import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm"
import { DateTime, Effect, Schema } from "effect"
import { Admitted, Delivery, Selection } from "@hena/schema/session-input"
import type { Database } from "../database/database"
import { EventV2 } from "../event"
import { EventTable } from "../event/sql"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { Prompt } from "./prompt"
import { SessionSchema } from "./schema"
import { SessionInputTable, SessionMessageTable } from "./sql"

type DatabaseService = Database.Interface["db"]

export { Admitted, Delivery, Selection }

const decodePrompt = Schema.decodeUnknownSync(Prompt)
const encodePrompt = Schema.encodeSync(Prompt)
const selectionEquals = Schema.toEquivalence(Selection)
export const queueOrder = sql<number>`CASE WHEN ${SessionInputTable.queue_position} = ${Number.MAX_SAFE_INTEGER} THEN ${SessionInputTable.admitted_seq} ELSE ${SessionInputTable.queue_position} END`

export const normalizeQueuePositions = Effect.fn("SessionInput.normalizeQueuePositions")(function* (
  db: DatabaseService,
) {
  yield* db
    .update(SessionInputTable)
    .set({ queue_position: sql`${SessionInputTable.admitted_seq}` })
    .where(eq(SessionInputTable.queue_position, Number.MAX_SAFE_INTEGER))
    .run()
    .pipe(Effect.orDie)
})

const fromRow = (row: typeof SessionInputTable.$inferSelect): Admitted =>
  Admitted.make({
    admittedSeq: row.admitted_seq,
    id: SessionMessage.ID.make(row.id),
    sessionID: SessionSchema.ID.make(row.session_id),
    prompt: decodePrompt(row.prompt),
    delivery: row.delivery,
    selection: row.selection ?? undefined,
    timeCreated: DateTime.makeUnsafe(row.time_created),
    ...(row.promoted_seq === null ? {} : { promotedSeq: row.promoted_seq }),
  })

export const find = Effect.fn("SessionInput.find")(function* (db: DatabaseService, id: SessionMessage.ID) {
  const row = yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.id, id)).get().pipe(Effect.orDie)
  return row === undefined ? undefined : fromRow(row)
})

const findHistorical = Effect.fn("SessionInput.findHistorical")(function* (
  db: DatabaseService,
  id: SessionMessage.ID,
  replacementOnly = false,
) {
  const admitted = and(
    eq(EventTable.type, EventV2.versionedType(SessionEvent.PromptAdmitted.type, 1)),
    eq(sql<string>`json_extract(${EventTable.data}, '$.messageID')`, id),
  )
  const replaced = and(
    eq(EventTable.type, EventV2.versionedType(SessionEvent.RevertEvent.Committed.type, 1)),
    eq(sql<string>`json_extract(${EventTable.data}, '$.replacement.messageID')`, id),
  )
  const row = yield* db
    .select({ seq: EventTable.seq, data: EventTable.data })
    .from(EventTable)
    .where(replacementOnly ? replaced : or(admitted, replaced))
    .get()
    .pipe(Effect.orDie)
  if (!row) return
  const raw = row.data as Record<string, unknown>
  const committed = raw.replacement ? Schema.decodeUnknownSync(SessionEvent.RevertEvent.Committed.data)(raw) : undefined
  const data = committed
    ? committed.replacement && {
        ...committed.replacement,
        selection: { agent: committed.replacement.agent, model: committed.replacement.model },
        sessionID: committed.sessionID,
        timestamp: committed.timestamp,
      }
    : Schema.decodeUnknownSync(SessionEvent.PromptAdmitted.data)(raw)
  if (!data) return
  return {
    admitted: Admitted.make({
      admittedSeq: row.seq,
      id: data.messageID,
      sessionID: data.sessionID,
      prompt: data.prompt,
      delivery: data.delivery,
      selection: "selection" in data ? data.selection : undefined,
      timeCreated: data.timestamp,
    }),
    boundary: committed?.messageID,
  }
})

export const lookup = Effect.fn("SessionInput.lookup")(function* (db: DatabaseService, id: SessionMessage.ID) {
  return (yield* find(db, id)) ?? (yield* findHistorical(db, id))?.admitted
})

export const lookupReplacement = Effect.fn("SessionInput.lookupReplacement")(function* (
  db: DatabaseService,
  id: SessionMessage.ID,
) {
  const historical = yield* findHistorical(db, id, true)
  if (!historical?.boundary) return
  return { admitted: historical.admitted, boundary: historical.boundary }
})

export class LifecycleConflict extends Schema.TaggedErrorClass<LifecycleConflict>()("SessionInput.LifecycleConflict", {
  id: SessionMessage.ID,
}) {}

class PromotionConflict extends Error {
  constructor(
    readonly promoted = 0,
    readonly selection?: Selection,
  ) {
    super()
  }
}

export type Promotion = { count: number; selection?: Selection }

export const admit = Effect.fn("SessionInput.admit")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly selection?: Selection
  },
) {
  const existing = yield* lookup(db, input.id)
  if (existing !== undefined) return existing
  const timestamp = yield* DateTime.now
  return yield* events
    .publish(SessionEvent.PromptAdmitted, {
      messageID: input.id,
      sessionID: input.sessionID,
      timestamp,
      prompt: input.prompt,
      delivery: input.delivery,
      selection: input.selection,
    })
    .pipe(
      Effect.flatMap((event) =>
        event.durable === undefined
          ? Effect.die("Prompt admission event is missing aggregate sequence")
          : Effect.succeed(
              Admitted.make({
                admittedSeq: event.durable.seq,
                id: input.id,
                sessionID: input.sessionID,
                prompt: input.prompt,
                delivery: input.delivery,
                selection: input.selection,
                timeCreated: timestamp,
              }),
            ),
      ),
      Effect.catchDefect((defect) =>
        find(db, input.id).pipe(Effect.flatMap((stored) => (stored ? Effect.succeed(stored) : Effect.die(defect)))),
      ),
    )
})

export const projectAdmitted = Effect.fn("SessionInput.projectAdmitted")(function* (
  db: DatabaseService,
  input: {
    readonly admittedSeq: number
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly selection?: Selection
    readonly timeCreated: DateTime.Utc
  },
) {
  const message = yield* db
    .select({ id: SessionMessageTable.id })
    .from(SessionMessageTable)
    .where(eq(SessionMessageTable.id, input.id))
    .get()
    .pipe(Effect.orDie)
  if (message !== undefined) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
  const stored = yield* db
    .insert(SessionInputTable)
    .values({
      id: input.id,
      session_id: input.sessionID,
      admitted_seq: input.admittedSeq,
      queue_position: input.admittedSeq,
      prompt: encodePrompt(input.prompt),
      delivery: input.delivery,
      selection: input.selection,
      time_created: DateTime.toEpochMillis(input.timeCreated),
    })
    .onConflictDoNothing()
    .returning({ id: SessionInputTable.id })
    .get()
    .pipe(Effect.orDie)
  if (!stored) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
})

export const projectPrompted = Effect.fn("SessionInput.projectPrompted")(function* (
  db: DatabaseService,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly selection?: Selection
    readonly timeCreated: DateTime.Utc
    readonly promotedSeq: number
  },
) {
  const updated = yield* db
    .update(SessionInputTable)
    .set({ promoted_seq: input.promotedSeq })
    .where(
      and(
        eq(SessionInputTable.id, input.id),
        eq(SessionInputTable.session_id, input.sessionID),
        isNull(SessionInputTable.promoted_seq),
      ),
    )
    .returning()
    .get()
    .pipe(Effect.orDie)
  if (updated) {
    const stored = fromRow(updated)
    if (!matchesProjection(stored, input)) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
    return
  }

  const stored = yield* find(db, input.id)
  if (stored) {
    if (!matchesProjection(stored, input) || stored.promotedSeq !== input.promotedSeq)
      return yield* Effect.die(new LifecycleConflict({ id: input.id }))
    return
  }

  yield* db
    .insert(SessionInputTable)
    .values({
      id: input.id,
      session_id: input.sessionID,
      prompt: encodePrompt(input.prompt),
      delivery: input.delivery,
      admitted_seq: input.promotedSeq,
      queue_position: input.promotedSeq,
      selection: input.selection,
      promoted_seq: input.promotedSeq,
      time_created: DateTime.toEpochMillis(input.timeCreated),
    })
    .run()
    .pipe(Effect.orDie)
})

export const hasPending = Effect.fn("SessionInput.hasPending")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  delivery: Delivery,
) {
  const row = yield* db
    .select({ id: SessionInputTable.id })
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        isNull(SessionInputTable.promoted_seq),
        eq(SessionInputTable.delivery, delivery),
      ),
    )
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  return row !== undefined
})

export const equivalent = (
  input: Admitted,
  expected: {
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly selection?: Selection
  },
) =>
  input.delivery === expected.delivery &&
  matchesPrompt(input, expected) &&
  (input.selection === undefined
    ? expected.selection === undefined
    : expected.selection !== undefined && selectionEquals(input.selection, expected.selection))

const matchesPrompt = (input: Admitted, expected: { readonly sessionID: SessionSchema.ID; readonly prompt: Prompt }) =>
  input.sessionID === expected.sessionID &&
  JSON.stringify(encodePrompt(input.prompt)) === JSON.stringify(encodePrompt(expected.prompt))

const matchesProjection = (
  input: Admitted,
  expected: {
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly selection?: Selection
    readonly timeCreated: DateTime.Utc
  },
) =>
  equivalent(input, expected) &&
  DateTime.toEpochMillis(input.timeCreated) === DateTime.toEpochMillis(expected.timeCreated)

const publish = Effect.fn("SessionInput.publish")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  rows: ReadonlyArray<typeof SessionInputTable.$inferSelect>,
  guard?: (row: typeof SessionInputTable.$inferSelect) => Effect.Effect<void>,
) {
  for (const [index, row] of rows.entries()) {
    const id = SessionMessage.ID.make(row.id)
    yield* events
      .publish(
        SessionEvent.Prompted,
        {
          sessionID,
          timestamp: DateTime.makeUnsafe(row.time_created),
          messageID: id,
          prompt: decodePrompt(row.prompt),
          delivery: row.delivery,
          selection: row.selection ?? undefined,
        },
        guard ? { guard: () => guard(row) } : undefined,
      )
      .pipe(
        Effect.catchDefect((defect) =>
          defect instanceof LifecycleConflict
            ? find(db, id).pipe(
                Effect.flatMap((stored) => (stored?.promotedSeq === undefined ? Effect.die(defect) : Effect.void)),
              )
            : defect instanceof PromotionConflict
              ? Effect.die(
                  new PromotionConflict(
                    index,
                    rows.slice(0, index).findLast((row) => row.selection)?.selection ?? undefined,
                  ),
                )
              : Effect.die(defect),
        ),
      )
  }
  return { count: rows.length, selection: rows.findLast((row) => row.selection)?.selection ?? undefined }
})

export const promoteSteers: (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  cutoff: number,
) => Effect.Effect<Promotion> = Effect.fn("SessionInput.promoteSteers")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  cutoff: number,
) {
  const rows = yield* db
    .select()
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        isNull(SessionInputTable.promoted_seq),
        eq(SessionInputTable.delivery, "steer"),
        lte(SessionInputTable.admitted_seq, cutoff),
      ),
    )
    .orderBy(asc(queueOrder), asc(SessionInputTable.admitted_seq))
    .all()
    .pipe(Effect.orDie)
  return yield* publish(db, events, sessionID, rows, (row) =>
    db
      .select({ id: SessionInputTable.id })
      .from(SessionInputTable)
      .where(
        and(
          eq(SessionInputTable.id, row.id),
          eq(SessionInputTable.session_id, sessionID),
          isNull(SessionInputTable.promoted_seq),
          eq(SessionInputTable.delivery, "steer"),
          lte(SessionInputTable.admitted_seq, cutoff),
        ),
      )
      .get()
      .pipe(
        Effect.orDie,
        Effect.flatMap((stored) => (stored ? Effect.void : Effect.die(new PromotionConflict()))),
      ),
  ).pipe(
    Effect.catchDefect((defect) =>
      defect instanceof PromotionConflict
        ? promoteSteers(db, events, sessionID, cutoff).pipe(
            Effect.map((promoted) => ({
              count: defect.promoted + promoted.count,
              selection: promoted.selection ?? defect.selection,
            })),
          )
        : Effect.die(defect),
    ),
  )
})

export const promoteNextQueued: (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
) => Effect.Effect<Promotion> = Effect.fn("SessionInput.promoteNextQueued")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
) {
  const row = yield* db
    .select()
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        isNull(SessionInputTable.promoted_seq),
        eq(SessionInputTable.delivery, "queue"),
      ),
    )
    .orderBy(asc(queueOrder), asc(SessionInputTable.admitted_seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  if (row === undefined) return { count: 0 }
  return yield* publish(db, events, sessionID, [row], () =>
    db
      .select({ id: SessionInputTable.id })
      .from(SessionInputTable)
      .where(
        and(
          eq(SessionInputTable.session_id, sessionID),
          isNull(SessionInputTable.promoted_seq),
          eq(SessionInputTable.delivery, "queue"),
        ),
      )
      .orderBy(asc(queueOrder), asc(SessionInputTable.admitted_seq))
      .limit(1)
      .get()
      .pipe(
        Effect.orDie,
        Effect.flatMap((stored) => (stored?.id === row.id ? Effect.void : Effect.die(new PromotionConflict()))),
      ),
  ).pipe(
    Effect.catchDefect((defect) =>
      defect instanceof PromotionConflict ? promoteNextQueued(db, events, sessionID) : Effect.die(defect),
    ),
  )
})
