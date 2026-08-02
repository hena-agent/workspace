export * as AttachFolderTool from "./attach-folder"

import { ToolFailure } from "@hena/llm"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { Project } from "../project"
import { QuestionV2 } from "../question"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "attach_folder"

export const description = `Ask the user to attach a folder to the current project when filesystem or coding work requires their files.

The tool does not accept a path. The user chooses the folder through Hena's directory picker.
Use this only when the current project has no attached folder. After a folder is attached, stop the current task and wait for the user's next message so the new coding context can load.`

export const Input = Schema.Struct({
  reason: Schema.String.annotate({ description: "Why an attached folder is needed" }),
})

export const Output = Schema.Struct({
  attached: Schema.Boolean,
})

export function modelOutput(attached: boolean) {
  return attached
    ? "The folder was attached. Stop now, tell the user the project is ready, and wait for their next message. Do not continue the original task in this turn."
    : "The folder was not attached. Do not continue with filesystem or coding work."
}

export function stopsTurn(tool: string, output: unknown) {
  return (
    tool === name &&
    typeof output === "object" &&
    output !== null &&
    "attached" in output &&
    output.attached === true
  )
}

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const question = yield* QuestionV2.Service
    const permission = yield* PermissionV2.Service
    const location = yield* Location.Service
    const projects = yield* Project.Service

    if (!(yield* projects.isFolderless(location.project.id))) return

    yield* tools
      .register({
        [name]: Tool.withPermission(
          Tool.make({
            description,
            input: Input,
            output: Output,
            toModelOutput: ({ output }) => [{ type: "text", text: modelOutput(output.attached) }],
            execute: (input, context) =>
              permission
                .assert({
                  action: "question",
                  resources: ["*"],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: {
                    type: "tool",
                    messageID: context.assistantMessageID,
                    callID: context.toolCallID,
                  },
                })
                .pipe(
                  Effect.mapError(() => new ToolFailure({ message: "Permission denied: question" })),
                  Effect.andThen(
                    question
                      .ask({
                        sessionID: context.sessionID,
                        questions: [
                          {
                            question: input.reason,
                            header: "Attach folder",
                            custom: false,
                            options: [],
                          },
                        ],
                        tool: { messageID: context.assistantMessageID, callID: context.toolCallID },
                        action: {
                          type: "attach-folder",
                          projectID: location.project.id,
                        },
                      })
                      .pipe(Effect.orDie),
                  ),
                  Effect.andThen(projects.isFolderless(location.project.id)),
                  Effect.map((folderless) => ({ attached: !folderless })),
                ),
          }),
          "question",
        ),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/attach-folder",
  layer,
  deps: [ToolRegistry.node, PermissionV2.node, QuestionV2.node, Location.node, Project.node],
})
