import { describe, expect, test } from "bun:test"
import { createConnectionAgent } from "@/connection/agent"
import { createSessionOptimistically } from "./session"

describe("session mutations", () => {
  test("stages new-session prompts in the selected delivery surface", () => {
    const fetcher = () => new Promise<Response>(() => {})
    const steerAgent = createConnectionAgent("http://steer.test", fetcher)
    const steer = createSessionOptimistically(steerAgent, {
      projectID: "project-1",
      location: { directory: "/workspace" },
      text: "Steer prompt",
      delivery: "steer",
    })
    expect(steerAgent.localMessages.rows(steer.sessionID)).toHaveLength(1)
    expect(steerAgent.store.rows("messages", steer.sessionID)).toEqual([])
    expect(steerAgent.store.rows("sessionInputs", steer.sessionID)).toEqual([])

    const queueAgent = createConnectionAgent("http://queue.test", fetcher)
    const queued = createSessionOptimistically(queueAgent, {
      projectID: "project-1",
      location: { directory: "/workspace" },
      text: "Queued prompt",
      delivery: "queue",
    })
    expect(queueAgent.localMessages.rows(queued.sessionID)).toEqual([])
    expect(queueAgent.store.rows("messages", queued.sessionID)).toEqual([])
    expect(queueAgent.store.rows("sessionInputs", queued.sessionID)).toHaveLength(1)

    steerAgent.dispose()
    queueAgent.dispose()
  })
})
