export * as ProjectAttachState from "./attach-state"

import type { ProjectSchema } from "./schema"
import { Effect } from "effect"

const blocked = new Set<ProjectSchema.ID>()
const active = new Map<ProjectSchema.ID, Set<Effect.Effect<void>>>()

// Compatibility runners register cancellation without Core depending on Hena.
export function register(projectID: ProjectSchema.ID, interrupt: Effect.Effect<void>) {
  const runners = active.get(projectID) ?? new Set<Effect.Effect<void>>()
  runners.add(interrupt)
  active.set(projectID, runners)
  return () => {
    runners.delete(interrupt)
    if (runners.size === 0) active.delete(projectID)
  }
}

export const interrupt = (projectID: ProjectSchema.ID) =>
  Effect.forEach([...(active.get(projectID) ?? [])], (effect) => effect, { discard: true })

export function block(projectID: ProjectSchema.ID) {
  blocked.add(projectID)
}

export function unblock(projectID: ProjectSchema.ID) {
  blocked.delete(projectID)
}

export function isBlocked(projectID: ProjectSchema.ID) {
  return blocked.has(projectID)
}
