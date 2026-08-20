import { describe, expect, test } from "bun:test"
import {
  getProject,
  getProjectNotificationState,
  getSession,
  groupSessionsByRecency,
  listConnections,
  listMessages,
  listProjects,
  listSessions,
} from "./queries"
import { MOCK_NOW } from "./fixtures"

describe("listConnections", () => {
  test("returns every configured connection", () => {
    expect(listConnections().map((c) => c.id)).toEqual(["conn-local", "conn-staging"])
  })
})

describe("listProjects", () => {
  test("returns all projects when no connection filter is given", () => {
    expect(listProjects().length).toBeGreaterThanOrEqual(4)
  })

  test("filters by connectionId", () => {
    const result = listProjects("conn-staging")
    expect(result.every((p) => p.connectionId === "conn-staging")).toBe(true)
    expect(result.length).toBe(1)
  })
})

describe("getProject", () => {
  test("returns the matching project", () => {
    expect(getProject("proj-hena")?.name).toBe("hena")
  })

  test("returns undefined for an unknown id", () => {
    expect(getProject("does-not-exist")).toBeUndefined()
  })
})

describe("listSessions", () => {
  test("filters by projectId and excludes archived sessions by default", () => {
    const result = listSessions({ projectId: "proj-hena" })
    expect(result.every((s) => s.projectId === "proj-hena")).toBe(true)
    expect(result.some((s) => s.archived)).toBe(false)
  })

  test("includes archived sessions when requested", () => {
    const result = listSessions({ projectId: "proj-hena", includeArchived: true })
    expect(result.some((s) => s.archived)).toBe(true)
  })

  test("sorts by updatedAt descending", () => {
    const result = listSessions({ projectId: "proj-hena" })
    const timestamps = result.map((s) => s.updatedAt)
    const sorted = [...timestamps].sort((a, b) => b - a)
    expect(timestamps).toEqual(sorted)
  })
})

describe("getSession", () => {
  test("returns the matching session", () => {
    expect(getSession("sess-transcript")?.title).toContain("collection stream protocol")
  })
})

describe("listMessages", () => {
  test("returns messages for a session in chronological order", () => {
    const result = listMessages("sess-transcript")
    expect(result.length).toBeGreaterThan(5)
    const timestamps = result.map((m) => m.createdAt)
    const sorted = [...timestamps].sort((a, b) => a - b)
    expect(timestamps).toEqual(sorted)
  })

  test("returns an empty array for a session with no messages", () => {
    expect(listMessages("does-not-exist")).toEqual([])
  })
})

describe("groupSessionsByRecency", () => {
  test("buckets sessions into today, yesterday, and older relative to MOCK_NOW", () => {
    const groups = groupSessionsByRecency(listSessions({ projectId: "proj-hena" }), MOCK_NOW)
    expect(groups.today.every((s) => s.updatedAt > MOCK_NOW - 24 * 60 * 60 * 1000)).toBe(true)
    expect(groups.older.length).toBeGreaterThan(0)
  })
})

describe("getProjectNotificationState", () => {
  test("reports permission when a session needs a permission or question reply", () => {
    expect(getProjectNotificationState("proj-hena").kind).toBe("permission")
  })

  test("reports working when any session is actively working", () => {
    expect(getProjectNotificationState("proj-hena").working).toBe(true)
  })

  test("reports none for a project with no active signals", () => {
    expect(getProjectNotificationState("proj-infra")).toEqual({ kind: "none", working: false })
  })
})
