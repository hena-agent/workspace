import { Project } from "@hena/schema/project"
import { AbsolutePath } from "@hena/schema/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { ConflictError, InvalidRequestError, ProjectNotFoundError, UnknownError } from "../errors"

export const ProjectGroup = HttpApiGroup.make("server.project")
  .add(
    HttpApiEndpoint.post("project.attach", "/api/project/:projectID/attach", {
      params: { projectID: Project.ID },
      payload: Schema.Struct({ directory: AbsolutePath }),
      success: HttpApiSchema.NoContent,
      error: [ProjectNotFoundError, ConflictError, InvalidRequestError, UnknownError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.project.attach",
        summary: "Attach chat project",
        description: "Move a chat project's managed files and sessions into a new or empty workspace directory.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "project", description: "Project management routes." }))
