import { Project } from "@hena/schema/project"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

export class ProjectNotFoundError extends Schema.TaggedErrorClass<ProjectNotFoundError>()(
  "ProjectNotFoundError",
  {
    projectID: Project.ID,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}

export class ProjectFolderConflictError extends Schema.TaggedErrorClass<ProjectFolderConflictError>()(
  "ProjectFolderConflictError",
  {
    projectID: Project.ID,
    folder: Schema.optional(Schema.String),
    message: Schema.String,
  },
  { httpApiStatus: 409 },
) {}

export class ProjectFolderInvalidError extends Schema.TaggedErrorClass<ProjectFolderInvalidError>()(
  "ProjectFolderInvalidError",
  {
    folder: Schema.String,
    message: Schema.String,
  },
  { httpApiStatus: 400 },
) {}

export const ProjectGroup = HttpApiGroup.make("server.project")
  .add(
    HttpApiEndpoint.get("project.list", "/api/project", {
      success: Schema.Array(Project.ManagedInfo),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.project.list", summary: "List projects" })),
  )
  .add(
    HttpApiEndpoint.post("project.create", "/api/project", {
      payload: Project.CreateInput,
      success: Project.ManagedInfo,
      error: [ProjectFolderConflictError, ProjectFolderInvalidError],
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.project.create", summary: "Create project" })),
  )
  .add(
    HttpApiEndpoint.get("project.get", "/api/project/:projectID", {
      params: { projectID: Project.ID },
      success: Project.ManagedInfo,
      error: ProjectNotFoundError,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.project.get", summary: "Get project" })),
  )
  .add(
    HttpApiEndpoint.put("project.attachFolder", "/api/project/:projectID/folder", {
      params: { projectID: Project.ID },
      payload: Schema.Struct({ folder: Project.AttachFolderInput.fields.folder }),
      success: Project.ManagedInfo,
      error: [ProjectNotFoundError, ProjectFolderConflictError, ProjectFolderInvalidError],
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.project.attachFolder", summary: "Attach project folder" })),
  )
  .annotateMerge(OpenApi.annotations({ title: "project", description: "Managed project routes." }))
