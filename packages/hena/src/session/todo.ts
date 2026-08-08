import { LayerNode } from "@hena/core/effect/layer-node"
import { SessionID } from "./schema"
import { Effect, Layer, Context } from "effect"
import { Database } from "@hena/core/database/database"
import { eq } from "drizzle-orm"
import { asc } from "drizzle-orm"
import { TodoTable } from "@hena/core/session/sql"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionTodo } from "@hena/schema/session-todo"
import { SessionTodoUpdate } from "@hena/core/session/todo-update"

export const Info = SessionTodo.Info
export type Info = SessionTodo.Info
export const Input = SessionTodo.Input
export type Input = SessionTodo.Input
export const ID = SessionTodo.ID
export const InvalidIDError = SessionTodoUpdate.InvalidIDError
export type InvalidIDError = SessionTodoUpdate.InvalidIDError
export const DuplicateIDError = SessionTodoUpdate.DuplicateIDError
export type DuplicateIDError = SessionTodoUpdate.DuplicateIDError

export const Event = SessionTodo.Event

export interface Interface {
  readonly update: (input: {
    sessionID: SessionID
    todos: ReadonlyArray<Input>
  }) => Effect.Effect<ReadonlyArray<Info>, InvalidIDError | DuplicateIDError>
  readonly get: (sessionID: SessionID) => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@hena/SessionTodo") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const { db } = yield* Database.Service

    const update = Effect.fn("Todo.update")(function* (input: { sessionID: SessionID; todos: ReadonlyArray<Input> }) {
      const result = yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const existing = yield* tx
              .select()
              .from(TodoTable)
              .where(eq(TodoTable.session_id, input.sessionID))
              .orderBy(asc(TodoTable.position))
              .all()
            const prepared = SessionTodoUpdate.prepare(existing, input.todos)
            if (!prepared.ok) return prepared
            yield* tx.delete(TodoTable).where(eq(TodoTable.session_id, input.sessionID)).run()
            if (prepared.todos.length > 0)
              yield* tx
                .insert(TodoTable)
                .values(
                  prepared.todos.map((todo, position) => ({
                    id: todo.id,
                    session_id: input.sessionID,
                    content: todo.content,
                    status: todo.status,
                    priority: todo.priority,
                    position,
                    ...(prepared.existingByID.has(todo.id)
                      ? { time_created: prepared.existingByID.get(todo.id)!.time_created }
                      : {}),
                  })),
                )
                .run()
            return { ok: true, todos: prepared.todos } as const
          }),
        )
        .pipe(Effect.orDie)
      if (!result.ok) return yield* Effect.fail(result.error)
      yield* events.publish(Event.Updated, { sessionID: input.sessionID, todos: result.todos })
      return result.todos
    })

    const get = Effect.fn("Todo.get")(function* (sessionID: SessionID) {
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

export const node = LayerNode.make({ service: Service, layer: layer, deps: [EventV2Bridge.node, Database.node] })

export * as Todo from "./todo"
