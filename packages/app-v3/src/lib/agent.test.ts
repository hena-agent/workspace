import { expect, test } from "bun:test"
import { resolveAgent } from "./agent"

test("agent selection skips unavailable saved IDs and preserves the first valid preference", () => {
  const agents = [
    { id: "plan", name: "Plan", description: "" },
    { id: "build", name: "Build", description: "" },
    { id: "review", name: "Review", description: "" },
  ]
  expect(resolveAgent(agents, "review", "plan")?.id).toBe("review")
  expect(resolveAgent(agents, "explore", "plan")?.id).toBe("plan")
  expect(resolveAgent(agents, undefined, "compaction", "review")?.id).toBe("review")
  expect(resolveAgent(agents, "explore", "compaction")?.id).toBe("build")
  expect(resolveAgent([agents[0]], "compaction")?.id).toBe("plan")
  expect(resolveAgent([], "build")).toBeUndefined()
})
