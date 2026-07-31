import { describe, expect, test } from "bun:test"
import type { ProjectAttachment, ProjectChat } from "@hena/sdk/v2/client"
import { createProjectChatActions } from "./global"

const chat = (id: string, directory: string): ProjectChat => ({
  id,
  name: id,
  directory,
  time: { created: 1, updated: 1 },
})

describe("project chat actions", () => {
  test("creates, stores, opens, and touches a chat directory", async () => {
    const calls: string[] = []
    let chats: ProjectChat[] = [chat("existing", "/existing")]
    const created = chat("created", "/scratch/created")
    const actions = createProjectChatActions({
      chats: () => chats,
      setChats: (update) => (chats = update(chats)),
      open: (directory) => void calls.push(`open:${directory}`),
      replace: () => {},
      touch: (directory) => void calls.push(`touch:${directory}`),
      create: async (name) => {
        calls.push(`create:${name}`)
        return created
      },
      attach: async () => {
        throw new Error("unexpected attach")
      },
      refreshSessions: async () => {},
    })

    await expect(actions.createChat("New chat")).resolves.toEqual({ chat: created, directory: created.directory })
    expect(chats).toEqual([created, chat("existing", "/existing")])
    expect(calls).toEqual(["create:New chat", "open:/scratch/created", "touch:/scratch/created"])
  })

  test("removes the source chat, replaces its route, and refreshes only returned sessions", async () => {
    const calls: string[] = []
    let chats = [chat("source", "/scratch"), chat("other", "/other")]
    const attachment: ProjectAttachment = {
      project: { id: "destination", directory: "/folder" },
      sessionIDs: ["session-2", "session-1"],
    }
    const actions = createProjectChatActions({
      chats: () => chats,
      setChats: (update) => (chats = update(chats)),
      open: () => {},
      replace: (previous, directory) => void calls.push(`replace:${previous}:${directory}`),
      touch: () => {},
      create: async () => {
        throw new Error("unexpected create")
      },
      attach: async (projectID, folder) => {
        calls.push(`attach:${projectID}:${folder}`)
        return attachment
      },
      refreshSessions: async (sessionIDs) => void calls.push(`refresh:${sessionIDs.join(",")}`),
    })

    await expect(actions.attachFolder("source", "/folder")).resolves.toEqual({
      project: attachment.project,
      sessionIDs: attachment.sessionIDs,
      previous: "/scratch",
      directory: "/folder",
    })
    expect(chats).toEqual([chat("other", "/other")])
    expect(calls).toEqual(["attach:source:/folder", "replace:/scratch:/folder", "refresh:session-2,session-1"])
  })

  test("keeps a committed attachment successful when cache refresh fails", async () => {
    let chats = [chat("source", "/scratch")]
    const actions = createProjectChatActions({
      chats: () => chats,
      setChats: (update) => (chats = update(chats)),
      open: () => {},
      replace: () => {},
      touch: () => {},
      create: async () => {
        throw new Error("unexpected create")
      },
      attach: async () => ({ project: { id: "project", directory: "/folder" }, sessionIDs: ["session"] }),
      refreshSessions: async () => {
        throw new Error("cache unavailable")
      },
    })

    await expect(actions.attachFolder("source", "/folder")).resolves.toMatchObject({ directory: "/folder" })
    expect(chats).toEqual([])
  })
})
