import { run as runTui, type TuiInput } from "@hena-agent/tui"
import { Global } from "@/global"
import { AppNodeBuilder } from "@hena-agent/core/effect/app-node-builder"
import { Effect } from "effect"

export function run(input: TuiInput) {
  return runTui(input).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
}
