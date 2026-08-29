import { afterEach, describe, expect, test } from "bun:test"
import { encodeServerSlug } from "@/lib/server-url"
import { listDrafts, loadDraft, removeDraft, saveDraft } from "./drafts"
import { loadLastSession, saveLastSession } from "./last-session"
import { applyProjectOrder, loadProjectOrder, saveProjectOrder } from "./project-order"
import { clearSeenWatermarks, markSessionSeen, wasSeenAfter } from "./seen"

const url = "http://localhost:4106"

afterEach(() => {
  localStorage.clear()
})

describe("local client state", () => {
  test("stores and removes versioned drafts under the server slug", () => {
    saveDraft(url, "draft", "/new/draft", {
      text: "continue this prompt",
      selection: { start: 4, end: 4 },
      delivery: "queue",
      droppedAttachments: 2,
    })

    expect(loadDraft(url, "draft")).toMatchObject({ text: "continue this prompt", delivery: "queue", droppedAttachments: 2 })
    expect(listDrafts(url)).toHaveLength(1)
    expect(localStorage.getItem(`hena.drafts.v1.${encodeServerSlug(url)}`)).not.toBeNull()
    removeDraft(url, "draft")
    expect(loadDraft(url, "draft")).toBeUndefined()
  })

  test("migrates a version-one draft without resetting user text", () => {
    localStorage.setItem(`hena.drafts.v1.${encodeServerSlug(url)}`, JSON.stringify({
      version: 1,
      drafts: { old: { route: "/old", text: "keep me", updatedAt: 1 } },
    }))
    expect(loadDraft(url, "old")?.text).toBe("keep me")
  })

  test("removes a draft when its content is cleared", () => {
    saveDraft(url, "draft", "/new/draft", {
      text: "remove me",
      selection: { start: 9, end: 9 },
      delivery: "steer",
      droppedAttachments: 0,
    })
    saveDraft(url, "draft", "/new/draft", {
      text: "",
      selection: { start: 0, end: 0 },
      delivery: "steer",
      droppedAttachments: 0,
    })

    expect(loadDraft(url, "draft")).toBeUndefined()
    expect(listDrafts(url)).toHaveLength(0)
  })

  test("tracks and clears per-server seen watermarks", () => {
    markSessionSeen(url, "session", 20)
    expect(wasSeenAfter(url, "session", 20)).toBe(true)
    expect(wasSeenAfter(url, "session", 21)).toBe(false)
    clearSeenWatermarks(url)
    expect(wasSeenAfter(url, "session", 1)).toBe(false)
  })

  test("remembers the last session for each project", () => {
    saveLastSession(url, "alpha", "session-1")
    saveLastSession(url, "beta", "session-2")
    saveLastSession(url, "alpha", "session-3")

    expect(loadLastSession(url, "alpha")).toBe("session-3")
    expect(loadLastSession(url, "beta")).toBe("session-2")
  })

  test("persists project order and puts newly discovered projects first", () => {
    const projects = ["alpha", "beta", "gamma"].map((id) => ({
      id,
      connectionId: url,
      name: id,
      path: `/${id}`,
      updatedAt: 0,
    }))
    saveProjectOrder(url, [projects[1], projects[0]])

    expect(loadProjectOrder(url)).toEqual(["beta", "alpha"])
    expect(applyProjectOrder(projects, loadProjectOrder(url)).map((project) => project.id)).toEqual([
      "gamma",
      "beta",
      "alpha",
    ])

    localStorage.setItem(`hena.project-order.v1.${encodeServerSlug(url)}`, JSON.stringify({ version: 1, projects: ["beta", "beta", "alpha"] }))
    expect(loadProjectOrder(url)).toEqual(["beta", "alpha"])
  })
})
