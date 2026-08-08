export * as SessionTodo from "./session-todo"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { ascending } from "./identifier"
import { optional, statics } from "./schema"
import { SessionID } from "./session-id"

export const ID = Schema.String.check(Schema.isStartsWith("todo"))
  .pipe(Schema.brand("SessionTodo.ID"))
  .annotate({ description: "Server-issued todo ID; preserve it when updating an existing todo" })
  .pipe(statics((schema) => ({ create: () => schema.make("todo_" + ascending()) })))
export type ID = typeof ID.Type

const fields = {
  content: Schema.String.annotate({ description: "Brief description of the task" }),
  status: Schema.String.annotate({
    description: "Current status of the task: pending, in_progress, completed, cancelled",
  }),
  priority: Schema.String.annotate({
    description: "Priority level of the task: high, medium, low",
  }),
}

export const Input = Schema.Struct({
  id: optional(ID),
  ...fields,
}).annotate({ identifier: "TodoInput" })
export interface Input extends Schema.Schema.Type<typeof Input> {}

export const Info = Schema.Struct({ id: ID, ...fields }).annotate({ identifier: "Todo" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

const Updated = define({
  type: "todo.updated",
  schema: {
    sessionID: SessionID,
    todos: Schema.Array(Info),
  },
})
export const Event = { Updated, Definitions: inventory(Updated) }
