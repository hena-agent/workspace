import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { ProjectV2 } from "@hena/core/project"
import { AttachFolderTool as CoreAttachFolderTool } from "@hena/core/tool/attach-folder"
import { Question } from "../question"
import * as Tool from "./tool"

export const Parameters = CoreAttachFolderTool.Input

export const AttachFolderTool = Tool.define(
  CoreAttachFolderTool.name,
  Effect.gen(function* () {
    const question = yield* Question.Service
    const projects = yield* ProjectV2.Service

    return {
      description: CoreAttachFolderTool.description,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          yield* question.ask({
            sessionID: ctx.sessionID,
            questions: [
              {
                question: params.reason,
                header: "Attach folder",
                custom: false,
                options: [],
              },
            ],
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
            action: {
              type: "attach-folder",
              projectID: instance.project.id,
              reason: params.reason,
            },
          })
          const attached = !(yield* projects.isFolderless(instance.project.id))

          return {
            title: attached ? "Folder attached" : "Folder attachment cancelled",
            output: CoreAttachFolderTool.modelOutput(attached),
            metadata: { attached },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
