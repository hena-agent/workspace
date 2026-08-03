import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Project } from "../src/project"

describe("Project", () => {
  test("trims valid create names", () => {
    expect(String(Schema.decodeUnknownSync(Project.CreateInput)({ name: "  Research  " } as unknown).name)).toBe(
      "Research",
    )
  })

  test("rejects empty create names", () => {
    expect(() => Schema.decodeUnknownSync(Project.CreateInput)({ name: "   " } as unknown)).toThrow()
  })

  test("includes the chat-created event", () => {
    expect(Project.Event.Definitions).toEqual([Project.Event.Updated, Project.Event.ChatCreated])
  })
})
