export * as Project from "./project"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { AbsolutePath, DateTimeUtcFromMillis, NonNegativeInt, optional } from "./schema"
import { ProjectID } from "./project-id"
import { SessionID } from "./session-id"

export const ID = ProjectID
export type ID = typeof ID.Type

export const Vcs = Schema.Literal("git").annotate({ identifier: "Project.Vcs" })
export const Icon = Schema.Struct({
  url: optional(Schema.String),
  override: optional(Schema.String),
  color: optional(Schema.String),
}).annotate({ identifier: "Project.Icon" })
export interface Icon extends Schema.Schema.Type<typeof Icon> {}
export const Commands = Schema.Struct({
  start: optional(
    Schema.String.annotate({ description: "Startup script to run when creating a new workspace (worktree)" }),
  ),
}).annotate({ identifier: "Project.Commands" })
export interface Commands extends Schema.Schema.Type<typeof Commands> {}
export const Time = Schema.Struct({
  created: NonNegativeInt,
  updated: NonNegativeInt,
  initialized: optional(NonNegativeInt),
}).annotate({ identifier: "Project.Time" })
export interface Time extends Schema.Schema.Type<typeof Time> {}

export const Info = Schema.Struct({
  id: ID,
  worktree: Schema.String,
  vcs: optional(Vcs),
  name: optional(Schema.String),
  icon: optional(Icon),
  commands: optional(Commands),
  time: Time,
  sandboxes: Schema.Array(Schema.String),
}).annotate({ identifier: "Project" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export interface Chat extends Schema.Schema.Type<typeof Chat> {}
export const Chat = Schema.Struct({
  id: ID,
  name: Schema.String,
  directory: AbsolutePath,
  time: Schema.Struct({
    created: DateTimeUtcFromMillis,
    updated: DateTimeUtcFromMillis,
  }),
}).annotate({ identifier: "Project.Chat" })

export interface Attachment extends Schema.Schema.Type<typeof Attachment> {}
export const Attachment = Schema.Struct({
  project: Schema.Struct({
    id: ID,
    directory: AbsolutePath,
    vcs: Vcs.pipe(optional),
  }),
  sessionIDs: Schema.Array(SessionID),
}).annotate({ identifier: "Project.Attachment" })

export interface AttachmentReceipt extends Schema.Schema.Type<typeof AttachmentReceipt> {}
export const AttachmentReceipt = Schema.Struct({
  projectID: ID,
  attachment: Attachment,
}).annotate({ identifier: "Project.AttachmentReceipt" })

export const CreateInput = Schema.Struct({
  name: Schema.String,
}).annotate({ identifier: "Project.CreateInput" })
export type CreateInput = typeof CreateInput.Type

const Updated = define({ type: "project.updated", schema: Info.fields })
const ChatCreated = define({ type: "project.chat.created", schema: Chat.fields })
const Attached = define({
  type: "project.next.attached",
  schema: {
    projectID: ID,
    attachment: Attachment,
    timestamp: DateTimeUtcFromMillis,
  },
})
export const Event = { Updated, ChatCreated, Attached, Definitions: inventory(Updated, ChatCreated, Attached) }
