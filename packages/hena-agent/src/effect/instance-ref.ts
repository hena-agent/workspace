import { Context } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import type { WorkspaceV2 } from "@hena-agent/core/workspace"

export const InstanceRef = Context.Reference<InstanceContext | undefined>("~hena-agent/InstanceRef", {
  defaultValue: () => undefined,
})

export const WorkspaceRef = Context.Reference<WorkspaceV2.ID | undefined>("~hena-agent/WorkspaceRef", {
  defaultValue: () => undefined,
})
