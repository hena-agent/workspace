export * as SessionTodo from "./todo"

import { asc, eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { SessionTodo } from "@hena/schema/session-todo"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { SessionSchema } from "./schema"
import { TodoTable } from "./sql"
import { SessionProjector } from "./projector"

export const Info = SessionTodo.Info
export type Info = typeof Info.Type
export const ID = SessionTodo.ID
type UpdateInfo = Omit<Info, "id"> & { readonly id?: string }
export const Event = SessionTodo.Event

export interface Interface {
  readonly update: (input: {
    readonly sessionID: SessionSchema.ID
    readonly todos: ReadonlyArray<UpdateInfo>
  }) => Effect.Effect<ReadonlyArray<Info>>
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<Info>>
}

export class Service extends Context.Service<Service, Interface>()("@hena/v2/SessionTodo") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service

    const update = Effect.fn("SessionTodo.update")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly todos: ReadonlyArray<UpdateInfo>
    }) {
      const existing = yield* db
        .select({ id: TodoTable.id })
        .from(TodoTable)
        .where(eq(TodoTable.session_id, input.sessionID))
        .orderBy(asc(TodoTable.position))
        .all()
        .pipe(Effect.orDie)
      const normalized = input.todos.map((todo, index) => ({
        ...todo,
        id:
          todo.id ? SessionTodo.ID.make(todo.id) :
          existing[index]?.id && !input.todos.some((item) => item.id === existing[index].id)
            ? existing[index].id
            : SessionTodo.ID.create(),
      }))
      yield* events.publish(Event.Updated, { ...input, todos: normalized })
      return normalized
    })

    const get = Effect.fn("SessionTodo.get")(function* (sessionID: SessionSchema.ID) {
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

export const node = makeLocationNode({ service: Service, layer, deps: [EventV2.node, Database.node, SessionProjector.node] })
