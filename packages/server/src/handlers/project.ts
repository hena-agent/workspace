import { ProjectAttach } from "@hena/core/project/attach"
import {
  ProjectAttachRecoveryRequiredError,
  ProjectNotFoundError,
  ConflictError,
  InvalidRequestError,
  UnknownError,
} from "@hena/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const ProjectHandler = HttpApiBuilder.group(Api, "server.project", (handlers) =>
  Effect.gen(function* () {
    const projects = yield* ProjectAttach.Service

    return handlers
      .handle(
        "project.attach",
        Effect.fn(function* (ctx) {
          return {
            data: yield* projects
              .attach({ projectID: ctx.params.projectID, directory: ctx.payload.directory })
              .pipe(Effect.mapError((error) => mapAttachError(error, ctx.payload.directory))),
          }
        }),
      )
      .handle(
        "project.attach.status",
        Effect.fn(function* (ctx) {
          return {
            data: yield* projects.get(ctx.params.projectID).pipe(Effect.mapError(mapProjectError)),
          }
        }),
      )
      .handle(
        "project.attach.recover",
        Effect.fn(function* (ctx) {
          return {
            data: yield* projects
              .recover(ctx.params.projectID)
              .pipe(Effect.mapError((error) => mapRecoveryError(error))),
          }
        }),
      )
  }),
)

function mapProjectError(error: ProjectAttach.NotFoundError) {
  return new ProjectNotFoundError({
    projectID: error.projectID,
    message: `Project not found: ${error.projectID}`,
  })
}

function mapRecoveryError(error: ProjectAttach.NotFoundError | ProjectAttach.RecoveryRequiredError) {
  if (error._tag === "ProjectAttach.NotFoundError") return mapProjectError(error)
  return new ProjectAttachRecoveryRequiredError({
    projectID: error.projectID,
    operationID: error.operationID,
    message: "Project attach requires filesystem recovery",
  })
}

function mapAttachError(error: ProjectAttach.Error, directory: string) {
  if (error._tag === "ProjectAttach.NotFoundError") return mapProjectError(error)
  if (error._tag === "ProjectAttach.RecoveryRequiredError") return mapRecoveryError(error)
  if (error.reason === "invalid_target")
    return new InvalidRequestError({ message: "Attach target must be outside the managed project" })
  if (error.reason === "target_not_empty")
    return new ConflictError({ message: "Attach target must be empty", resource: directory })
  if (error.reason === "not_chat") return new ConflictError({ message: "Only chat projects can be attached" })
  return new UnknownError({ message: "Failed to move the chat project" })
}
