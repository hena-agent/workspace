import { describe, expect, test } from "bun:test"
import { Project } from "../src/project"

describe("Project", () => {
  test("creates path-safe managed IDs", () => {
    expect(String(Project.ID.create())).toMatch(/^prj_[0-9A-Za-z]+$/)
  })
})
