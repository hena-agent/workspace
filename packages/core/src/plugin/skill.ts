/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeHenaContent from "./skill/customize-hena.md" with { type: "text" }

export const CustomizeHenaContent = customizeHenaContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "customize-hena",
            description:
              "Use ONLY when the user is editing or creating Hena's own configuration: hena.json, hena.jsonc, files under .hena/, or files under ~/.config/hena/. Also use when creating or fixing Hena agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring Hena itself.",
            location: AbsolutePath.make("/builtin/customize-hena.md"),
            content: CustomizeHenaContent,
          }),
        }),
      )
    })
  }),
})
