export * as SessionTodo from "./todo"

import { asc, eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { SessionTodo } from "@hena/schema/session-todo"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { SessionSchema } from "./schema"
import { TodoTable } from "./sql"
import { SessionTodoUpdate } from "./todo-update"

export const Info = SessionTodo.Info
export type Info = typeof Info.Type
export const Input = SessionTodo.Input
export type Input = typeof Input.Type
export const ID = SessionTodo.ID
export const Event = SessionTodo.Event
export const InvalidIDError = SessionTodoUpdate.InvalidIDError
export type InvalidIDError = SessionTodoUpdate.InvalidIDError
export const DuplicateIDError = SessionTodoUpdate.DuplicateIDError
export type DuplicateIDError = SessionTodoUpdate.DuplicateIDError

export interface Interface {
  readonly update: (input: {
    readonly sessionID: SessionSchema.ID
    readonly todos: ReadonlyArray<Input>
  }) => Effect.Effect<ReadonlyArray<Info>, InvalidIDError | DuplicateIDError>
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
      readonly todos: ReadonlyArray<Input>
    }) {
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

export const node = makeLocationNode({ service: Service, layer, deps: [EventV2.node, Database.node] })
