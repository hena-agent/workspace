import { describe, expect, test } from "bun:test"
import { Project } from "../src/project"

describe("Project", () => {
  test("creates path-safe managed IDs", () => {
    expect(Project.ID.isManaged(Project.ID.create())).toBe(true)
    expect(Project.ID.isManaged(Project.ID.global)).toBe(false)
  })
})
