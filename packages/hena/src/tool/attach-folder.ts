import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Question } from "../question"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  reason: Schema.String.annotate({ description: "Why an attached folder is needed" }),
})

export const AttachFolderTool = Tool.define(
  "attach_folder",
  Effect.gen(function* () {
    const question = yield* Question.Service

    return {
      description: `Ask the user to attach a folder to the current project when filesystem or coding work requires their files.

The tool does not accept a path. The user chooses the folder through Hena's directory picker.
Use this only when the current project has no attached folder. After a folder is attached, stop the current task and wait for the user's next message so the new coding context can load.`,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const answers = yield* question.ask({
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
          const attached = answers[0]?.[0] === "Folder attached"

          return {
            title: attached ? "Folder attached" : "Folder attachment cancelled",
            output: attached
              ? "The folder was attached. Stop now, tell the user the project is ready, and wait for their next message. Do not continue the original task in this turn."
              : "The user cancelled folder attachment. Do not continue with filesystem or coding work.",
            metadata: { attached },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
