import { LayerNode } from "@hena/core/effect/layer-node"
import { SessionID } from "./schema"
import { Effect, Layer, Context } from "effect"
import { Database } from "@hena/core/database/database"
import { eq, sql } from "drizzle-orm"
import { asc } from "drizzle-orm"
import { TodoTable } from "@hena/core/session/sql"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionTodo } from "@hena/schema/session-todo"
import { SessionProjector } from "@hena/core/session/projector"

export const Info = SessionTodo.Info
export type Info = SessionTodo.Info

export const Event = SessionTodo.Event

export interface Interface {
  readonly update: (input: { sessionID: SessionID; todos: ReadonlyArray<Info> }) => Effect.Effect<Info[]>
  readonly get: (sessionID: SessionID) => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@hena/SessionTodo") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const { db } = yield* Database.Service

    const update = Effect.fn("Todo.update")(function* (input: { sessionID: SessionID; todos: ReadonlyArray<Info> }) {
      yield* repairMissingIDs(db, input.sessionID)
      const todos = input.todos.map((todo) => ({
        ...todo,
        id: todo.id ?? SessionTodo.ID.create(),
      }))
      yield* events.publish(Event.Updated, { ...input, todos })
      return todos
    })

    const get = Effect.fn("Todo.get")(function* (sessionID: SessionID) {
      yield* repairMissingIDs(db, sessionID)
      const rows = yield* db
        .select()
        .from(TodoTable)
        .where(eq(TodoTable.session_id, sessionID))
        .orderBy(asc(TodoTable.position))
        .all()
        .pipe(Effect.orDie)
      return rows.map((row) => ({
        id: row.id,
        content: row.content,
        status: row.status,
        priority: row.priority,
      }))
    })

    return Service.of({ update, get })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [EventV2Bridge.node, Database.node, SessionProjector.node],
})

function repairMissingIDs(db: Database.Interface["db"], sessionID: SessionID) {
  return db
    .run(
      sql`
    UPDATE todo SET id = 'todo_' || lower(hex(randomblob(16)))
    WHERE session_id = ${sessionID} AND id IS NULL
  `,
    )
    .pipe(Effect.orDie)
}

export * as Todo from "./todo"
