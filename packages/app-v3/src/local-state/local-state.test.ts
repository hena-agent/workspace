import { afterEach, describe, expect, test } from "bun:test"
import { encodeServerSlug } from "@/lib/server-url"
import { listDrafts, loadDraft, removeDraft, saveDraft, type DraftBody } from "./drafts"
import { applyProjectOrder, loadProjectOrder, saveProjectOrder } from "./project-order"
import { markSessionOpened, recentlyOpened } from "./recent"

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

  test.each([1, 2])("preserves legacy model IDs in v%s drafts when other drafts are saved or removed", (version) => {
    const key = `hena.drafts.v1.${encodeServerSlug(url)}`
    const old = { text: "keep me", modelID: "gpt-5.2", selection: { start: 2, end: 2 }, delivery: "queue", droppedAttachments: 1 } satisfies DraftBody
    localStorage.setItem(key, JSON.stringify(version === 1
      ? { version, drafts: { old: { ...old, route: "/old", updatedAt: 1 } } }
      : { version, index: [{ key: "old", route: "/old", updatedAt: 1 }], bodies: { old } }))

    expect(loadDraft(url, "old")).toEqual(old)
    saveDraft(url, "other", "/other", { text: "new", selection: { start: 0, end: 0 }, delivery: "steer", droppedAttachments: 0 })
    removeDraft(url, "other")
    expect(loadDraft(url, "old")).toEqual(old)
    expect(JSON.parse(localStorage.getItem(key)!).bodies.old.modelID).toBe("gpt-5.2")

    saveDraft(url, "old", "/old", { ...loadDraft(url, "old"), model: { id: "gpt-5.2", providerId: "azure" } })
    expect(loadDraft(url, "old")).toEqual({ ...old, modelID: undefined, model: { id: "gpt-5.2", providerId: "azure" } })
    expect(JSON.parse(localStorage.getItem(key)!).bodies.old).not.toHaveProperty("modelID")
  })

  test("tracks recently opened sessions per server, most recent last", () => {
    markSessionOpened(url, "session")
    markSessionOpened(url, "other")
    markSessionOpened(url, "session")
    expect(recentlyOpened(url)).toEqual(["other", "session"])
  })

  test("repeated opens of the already-most-recent session do not reorder or duplicate it", () => {
    markSessionOpened(url, "other")
    markSessionOpened(url, "session")
    markSessionOpened(url, "session")
    markSessionOpened(url, "session")
    expect(recentlyOpened(url)).toEqual(["other", "session"])
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
