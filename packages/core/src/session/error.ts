import { Schema } from "effect"
import { NonNegativeInt } from "../schema"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionTodo } from "@hena/schema/session-todo"

export class MessageDecodeError extends Schema.TaggedErrorClass<MessageDecodeError>()("Session.MessageDecodeError", {
  sessionID: SessionSchema.ID,
  messageID: SessionMessage.ID,
}) {
  override get message() {
    return `Failed to decode message ${this.messageID} in session ${this.sessionID}`
  }
}

export class ContextSnapshotDecodeError extends Schema.TaggedErrorClass<ContextSnapshotDecodeError>()(
  "Session.ContextSnapshotDecodeError",
  {
    sessionID: SessionSchema.ID,
    details: Schema.String,
  },
) {
  override get message() {
    return `Failed to decode context snapshot for session ${this.sessionID}: ${this.details}`
  }
}

export class QueueRevisionConflictError extends Schema.TaggedErrorClass<QueueRevisionConflictError>()(
  "Session.QueueRevisionConflictError",
  {
    sessionID: SessionSchema.ID,
    expected: NonNegativeInt,
    actual: NonNegativeInt,
  },
) {}

export class QueueStateConflictError extends Schema.TaggedErrorClass<QueueStateConflictError>()(
  "Session.QueueStateConflictError",
  {
    sessionID: SessionSchema.ID,
    revision: NonNegativeInt,
    messageIDs: Schema.Array(SessionMessage.ID),
  },
) {}

export class TodoConflictError extends Schema.TaggedErrorClass<TodoConflictError>()("Session.TodoConflictError", {
  sessionID: SessionSchema.ID,
  todoID: SessionTodo.ID,
  reason: Schema.Literals(["duplicate", "owned_by_another_session"]),
}) {}
