export * as ProjectSchema from "./schema"

import { Schema } from "effect"
import { Project } from "@hena/schema/project"
import { AbsolutePath } from "../schema"

export const ID = Project.ID
export type ID = typeof ID.Type

export const Chat = Project.Chat
export type Chat = Project.Chat

export const Attachment = Project.Attachment
export type Attachment = Project.Attachment

export const AttachmentReceipt = Project.AttachmentReceipt
export type AttachmentReceipt = Project.AttachmentReceipt

export const Event = Project.Event

export const Vcs = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("git"),
    store: AbsolutePath,
  }),
])
export type Vcs = typeof Vcs.Type
