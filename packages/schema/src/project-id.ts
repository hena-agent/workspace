import { Schema } from "effect"
import { ascending } from "./identifier"
import { statics } from "./schema"

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
