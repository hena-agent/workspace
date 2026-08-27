export * as Project from "./project"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { AbsolutePath, NonNegativeInt, optional, statics } from "./schema"
import { ProjectID } from "./project-id"

export const ID = ProjectID
export type ID = typeof ID.Type

export const Vcs = Schema.Literal("git").annotate({ identifier: "Project.Vcs" })
export const Mode = Schema.Literals(["chat", "workspace"]).annotate({ identifier: "Project.Mode" })
export type Mode = typeof Mode.Type
export const AttachOperationID = Schema.String.check(Schema.isStartsWith("pat_")).pipe(
  Schema.brand("Project.AttachOperationID"),
  statics((schema) => ({ create: () => schema.make(`pat_${crypto.randomUUID()}`) })),
)
export type AttachOperationID = typeof AttachOperationID.Type
export const AttachPhase = Schema.Literals([
  "prepared",
  "copied",
  "target_ready",
  "sessions_moved",
  "committed",
  "cleanup_pending",
  "completed",
  "rolling_back",
  "rolled_back",
  "recovery_required",
]).annotate({ identifier: "Project.AttachPhase" })
export type AttachPhase = typeof AttachPhase.Type
export interface AttachOperation extends Schema.Schema.Type<typeof AttachOperation> {}
export const AttachOperation = Schema.Struct({
  id: AttachOperationID,
  projectID: ID,
  source: AbsolutePath,
  target: AbsolutePath,
  phase: AttachPhase,
  error: Schema.String.pipe(optional),
  time: Schema.Struct({
    created: NonNegativeInt,
    updated: NonNegativeInt,
  }),
}).annotate({ identifier: "Project.AttachOperation" })
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
  mode: Mode,
  vcs: optional(Vcs),
  name: optional(Schema.String),
  icon: optional(Icon),
  commands: optional(Commands),
  time: Time,
  sandboxes: Schema.Array(Schema.String),
}).annotate({ identifier: "Project" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

const Updated = define({ type: "project.updated", schema: Info.fields })
export const Event = { Updated, Definitions: inventory(Updated) }
