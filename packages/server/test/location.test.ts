import { describe, expect, test } from "bun:test"
import { AbsolutePath } from "@hena-agent/core/schema"
import { WorkspaceV2 } from "@hena-agent/core/workspace"
import { ref } from "../src/location"

describe("location headers", () => {
  test("reads Hena Agent headers", () => {
    const location = ref({
      url: "/",
      headers: {
        "x-hena-agent-directory": encodeURIComponent("/project path"),
        "x-hena-agent-workspace": "wrk_test",
      },
    })

    expect(location.directory).toBe(AbsolutePath.make("/project path"))
    expect(location.workspaceID).toBe(WorkspaceV2.ID.make("wrk_test"))
  })
})
