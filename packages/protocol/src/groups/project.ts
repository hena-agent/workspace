import { Project } from "@hena/schema/project"
import { AbsolutePath } from "@hena/schema/schema"
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
      success: Schema.Array(Project.Chat),
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.project.list", summary: "List projects" })),
  )
  .add(
    HttpApiEndpoint.post("project.create", "/api/project", {
      payload: Project.CreateInput,
      success: Project.Chat,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.project.create", summary: "Create project" })),
  )
  .add(
    HttpApiEndpoint.get("project.get", "/api/project/:projectID", {
      params: { projectID: Project.ID },
      success: Project.Chat,
      error: ProjectNotFoundError,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.project.get", summary: "Get project" })),
  )
  .add(
    HttpApiEndpoint.put("project.attachFolder", "/api/project/:projectID/folder", {
      params: { projectID: Project.ID },
      // Re-declaring the required field avoids losing its requiredness when
      // projecting it from the composite input schema.
      payload: Schema.Struct({ folder: AbsolutePath }),
      success: Project.Attachment,
      error: [ProjectNotFoundError, ProjectFolderInvalidError],
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.project.attachFolder", summary: "Attach project folder" })),
  )
  .annotateMerge(OpenApi.annotations({ title: "project", description: "Folderless chat project routes." }))
