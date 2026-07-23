import type { WorkspaceV2 } from "@hena-agent/core/workspace"
import { Flag } from "@hena-agent/core/flag/flag"
import { Effect, Scope } from "effect"

/**
 * Scoped override for `Flag.HENA_AGENT_WORKSPACE_ID`. Saves the previous value
 * on entry and restores it via finalizer when the surrounding scope closes —
 * preserves the original try/finally semantics regardless of test outcome.
 */
export function withFixedWorkspaceID(id: WorkspaceV2.ID): Effect.Effect<void, never, Scope.Scope> {
  return Effect.gen(function* () {
    const previous = Flag.HENA_AGENT_WORKSPACE_ID
    Flag.HENA_AGENT_WORKSPACE_ID = id
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        Flag.HENA_AGENT_WORKSPACE_ID = previous
      }),
    )
  })
}
