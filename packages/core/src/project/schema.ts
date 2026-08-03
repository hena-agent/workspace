export * as ProjectSchema from "./schema"

import { Schema } from "effect"
import { Project } from "@hena/schema/project"
import { AbsolutePath } from "../schema"

export const ID = Project.ID
export type ID = typeof ID.Type

export const Vcs = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("git"),
    store: AbsolutePath,
  }),
])
export type Vcs = typeof Vcs.Type

export const Name = Project.Name
export type Name = Project.Name

export const Chat = Project.Chat
export type Chat = Project.Chat

export const CreateInput = Project.CreateInput
export type CreateInput = Project.CreateInput

export const Event = Project.Event
