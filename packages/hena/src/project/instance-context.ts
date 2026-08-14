import { LocalContext } from "@/util/local-context"
import { FSUtil } from "@hena/core/fs-util"
import type * as Project from "./project"

export interface InstanceContext {
  directory: string
  worktree: string
  project: Project.Info
}

export const context = LocalContext.create<InstanceContext>("instance")

/**
 * Check if a path is within the project boundary.
 * Returns true if path is inside ctx.directory OR ctx.worktree.
 * Paths within the worktree but outside the working directory should not trigger external_directory permission.
 */
export function containsPath(filepath: string, ctx: InstanceContext): boolean {
  // Non-git projects set worktree to "/" which would match ANY absolute path.
  // Skip worktree check in this case to preserve external_directory permissions.
  const roots = ctx.worktree === "/" ? [ctx.directory] : [ctx.directory, ctx.worktree]
  if (!roots.some((root) => FSUtil.contains(root, filepath))) return false
  const resolved = FSUtil.resolve(filepath)
  return roots.some((root) => FSUtil.contains(FSUtil.resolve(root), resolved))
}
