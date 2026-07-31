import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@hena/core/effect/app-node-builder"
import { LayerNode } from "@hena/core/effect/layer-node"
import { Location } from "@hena/core/location"
import { PermissionV2 } from "@hena/core/permission"
import { ProjectV2 } from "@hena/core/project"
import { QuestionV2 } from "@hena/core/question"
import { SessionV2 } from "@hena/core/session"
import { AbsolutePath } from "@hena/core/schema"
import { AttachFolderTool } from "@hena/core/tool/attach-folder"
import { ToolRegistry } from "@hena/core/tool/registry"
import { ToolOutputStore } from "@hena/core/tool-output-store"
import { Effect, Layer } from "effect"
import { testEffect } from "./lib/effect"
import { settleTool, toolDefinitions, toolIdentity } from "./lib/tool"

const projectID = ProjectV2.ID.make("prj_attach_folder_tool_test")
const sessionID = SessionV2.ID.make("ses_attach_folder_tool_test")
const directory = AbsolutePath.make("/scratch")
let captured: QuestionV2.AskInput | undefined
let folderlessChecks = 0

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, AttachFolderTool.node]), [
    [
      PermissionV2.node,
      Layer.mock(PermissionV2.Service, {
        assert: () => Effect.void,
      }),
    ],
    [
      QuestionV2.node,
      Layer.mock(QuestionV2.Service, {
        ask: (input) =>
          Effect.sync(() => {
            captured = input
            return [["not a status sentinel"]]
          }),
      }),
    ],
    [
      ProjectV2.node,
      Layer.mock(ProjectV2.Service, {
        isFolderless: () => Effect.sync(() => folderlessChecks++ === 0),
      }),
    ],
    [
      Location.node,
      Layer.succeed(Location.Service, {
        directory,
        project: { id: projectID, directory },
      }),
    ],
    [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
  ]),
)

describe("AttachFolderTool", () => {
  it.effect("asks the App to attach the current project and stops the turn", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      expect(AttachFolderTool.stopsTurn(AttachFolderTool.name, { attached: true })).toBe(true)
      expect(AttachFolderTool.stopsTurn(AttachFolderTool.name, { attached: false })).toBe(false)
      expect(AttachFolderTool.stopsTurn("question", { attached: true })).toBe(false)
      expect((yield* toolDefinitions(registry)).map((definition) => definition.name)).toEqual(["attach_folder"])

      const result = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-attach-folder",
          name: "attach_folder",
          input: { reason: "I need the source files" },
        },
      })

      expect(captured?.action).toEqual({
        type: "attach-folder",
        projectID,
        reason: "I need the source files",
      })
      expect(result.result).toEqual({
        type: "text",
        value:
          "The folder was attached. Stop now, tell the user the project is ready, and wait for their next message. Do not continue the original task in this turn.",
      })
    }),
  )
})
