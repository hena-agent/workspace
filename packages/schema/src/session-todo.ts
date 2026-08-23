export * as SessionTodo from "./session-todo"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { SessionID } from "./session-id"
import { ascending } from "./identifier"
import { optional, statics } from "./schema"

export const ID = Schema.String.check(Schema.isStartsWith("todo_")).pipe(
  Schema.brand("SessionTodo.ID"),
  statics((schema) => ({ create: () => schema.make(`todo_${ascending()}`) })),
)
export type ID = typeof ID.Type

export const Info = Schema.Struct({
  id: ID.pipe(optional).annotate({ description: "Stable identity from a prior update; omit only for a new todo" }),
  content: Schema.String.annotate({ description: "Brief description of the task" }),
  status: Schema.String.annotate({
    description: "Current status of the task: pending, in_progress, completed, cancelled",
  }),
  priority: Schema.String.annotate({
    description: "Priority level of the task: high, medium, low",
  }),
}).annotate({ identifier: "Todo" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

const Updated = define({
  type: "todo.updated",
  schema: {
    sessionID: SessionID,
    todos: Schema.Array(Info),
  },
})
export const Event = { Updated, Definitions: inventory(Updated) }
