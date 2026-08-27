export * as ProjectAttachState from "./attach-state"

import type { ProjectSchema } from "./schema"

const blocked = new Set<ProjectSchema.ID>()

export function block(projectID: ProjectSchema.ID) {
  blocked.add(projectID)
}

export function unblock(projectID: ProjectSchema.ID) {
  blocked.delete(projectID)
}

export function isBlocked(projectID: ProjectSchema.ID) {
  return blocked.has(projectID)
}
