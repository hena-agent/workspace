import { Project } from "@hena/schema/project"
import { AbsolutePath } from "@hena/schema/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import {
  ConflictError,
  InvalidRequestError,
  ProjectAttachRecoveryRequiredError,
  ProjectNotFoundError,
  UnknownError,
} from "../errors"

export const ProjectGroup = HttpApiGroup.make("server.project")
  .add(
    HttpApiEndpoint.post("project.attach", "/api/project/:projectID/attach", {
      params: { projectID: Project.ID },
      payload: Schema.Struct({ directory: AbsolutePath }),
      success: Schema.Struct({ data: Project.AttachOperation }),
      error: [
        ProjectNotFoundError,
        ProjectAttachRecoveryRequiredError,
        ConflictError,
        InvalidRequestError,
        UnknownError,
      ],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.project.attach",
        summary: "Attach chat project",
        description: "Move a chat project's managed files and sessions into a new or empty workspace directory.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("project.attach.status", "/api/project/:projectID/attach", {
      params: { projectID: Project.ID },
      success: Schema.Struct({ data: Schema.optional(Project.AttachOperation) }),
      error: ProjectNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.project.attach.status",
        summary: "Get project attach status",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("project.attach.recover", "/api/project/:projectID/attach/recover", {
      params: { projectID: Project.ID },
      success: Schema.Struct({ data: Schema.optional(Project.AttachOperation) }),
      error: [ProjectNotFoundError, ProjectAttachRecoveryRequiredError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.project.attach.recover",
        summary: "Recover project attach",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "project", description: "Project management routes." }))
