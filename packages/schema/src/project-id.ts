import { Schema } from "effect"
import { ascending } from "./identifier"
import { statics } from "./schema"

// Managed IDs are used verbatim as path segments, so their producer and recognizer stay together.
const managed = /^prj_[0-9A-Za-z]+$/

export const ProjectID = Schema.String.pipe(
  Schema.brand("Project.ID"),
  statics((schema) => ({
    global: schema.make("global"),
    create: () => schema.make("prj_" + ascending()),
    isManaged: (value: string) => managed.test(value),
  })),
)
export type ProjectID = typeof ProjectID.Type
