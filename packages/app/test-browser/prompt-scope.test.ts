import { expect, test } from "bun:test"
import { ServerConnection } from "@/context/server"
import { selectPromptTab } from "@/context/prompt"
import { retargetProjectDrafts, tabHref, tabKey, type Tab } from "@/context/tabs"
import { createStore, produce } from "solid-js/store"

test("selects the explicitly scoped session tab instead of the active tab", () => {
  const server = ServerConnection.Key.make("local")
  const tabs: Tab[] = [
    { type: "session", server, sessionId: "A" },
    { type: "session", server, sessionId: "B" },
  ]

  expect(selectPromptTab(tabs, { dir: "repo", id: "B" }, server)).toBe(tabs[1])
})

test("attaching a project retargets only its server's drafts without changing tab identity", () => {
  const server = ServerConnection.Key.make("local")
  const original: Tab[] = [
    { type: "draft", draftID: "active", server, directory: "/managed", projectID: "chat", worktree: "/managed" },
    { type: "draft", draftID: "background", server, directory: "/managed", projectID: "chat" },
    { type: "draft", draftID: "other-project", server, directory: "/managed", projectID: "other" },
    { type: "draft", draftID: "folder", server, directory: "/managed" },
    {
      type: "draft",
      draftID: "other-server",
      server: ServerConnection.Key.make("remote"),
      directory: "/managed",
      projectID: "chat",
    },
    { type: "session", server, sessionId: "existing" },
  ]
  const [tabs, setTabs] = createStore(structuredClone(original))
  const keys = tabs.map(tabKey)
  const hrefs = tabs.map(tabHref)
  setTabs(produce((tabs) => retargetProjectDrafts(tabs, server, "chat", "/attached")))

  expect(tabs.slice(0, 2)).toEqual([
    { type: "draft", draftID: "active", server, directory: "/attached" },
    { type: "draft", draftID: "background", server, directory: "/attached" },
  ])
  expect(tabs.slice(2)).toEqual(original.slice(2))
  expect(tabs.map(tabKey)).toEqual(keys)
  expect(tabs.map(tabHref)).toEqual(hrefs)
})
