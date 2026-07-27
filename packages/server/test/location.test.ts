import { describe, expect, test } from "bun:test"
import { AbsolutePath } from "@hena/core/schema"
import { WorkspaceV2 } from "@hena/core/workspace"
import { ref } from "../src/location"

describe("location headers", () => {
  test("reads Hena headers", () => {
    const location = ref({
      url: "/",
      headers: {
        "x-hena-directory": encodeURIComponent("/project path"),
        "x-hena-workspace": "wrk_test",
      },
    })

    expect(location.directory).toBe(AbsolutePath.make("/project path"))
    expect(location.workspaceID).toBe(WorkspaceV2.ID.make("wrk_test"))
  })
})
