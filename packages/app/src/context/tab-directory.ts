import { pathKey } from "@/utils/path-key"
import type { ServerConnection } from "./server"
import type { Tab } from "./tabs"

export function replaceDraftDirectory(tabs: Tab[], server: ServerConnection.Key, previous: string, directory: string) {
  const source = pathKey(previous)
  const destination = pathKey(directory)
  return tabs.map((tab) => {
    if (tab.type !== "draft" || tab.server !== server) return tab
    const replaceDirectory = pathKey(tab.directory) === source
    const replaceWorktree = !!tab.worktree && pathKey(tab.worktree) === source
    if (!replaceDirectory && !replaceWorktree) return tab
    return {
      ...tab,
      directory: replaceDirectory ? destination : tab.directory,
      ...(replaceWorktree ? { worktree: destination } : {}),
    }
  })
}
