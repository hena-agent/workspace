import { describe, expect, test } from "bun:test"
import { createConnectionAgent } from "@/connection/agent"
import { admitPromptOptimistically, createSessionOptimistically, getMutationStateVersion } from "./session"

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

  test("stages existing-session prompts in the selected delivery surface", () => {
    const agent = createConnectionAgent("http://hena.test", () => new Promise<Response>(() => {}))
    agent.store.applySnapshot("sessions", "", [
      { key: "steer", row: { id: "steer", working: false, queueRevision: 0, time: { updated: 1 } } },
      { key: "queue", row: { id: "queue", working: false, queueRevision: 2, time: { updated: 1 } } },
    ], 1)

    const steer = admitPromptOptimistically(agent, { sessionID: "steer", text: "Steer prompt", delivery: "steer" })
    const queued = admitPromptOptimistically(agent, { sessionID: "queue", text: "Queued prompt", delivery: "queue" })

    expect(agent.localMessages.rows("steer")).toHaveLength(1)
    expect(agent.store.rows("sessionInputs", "steer")).toEqual([])
    expect(agent.store.rows("sessions").find((row) => row.id === "steer")?.working).toBe(true)
    expect(agent.localMessages.rows("queue")).toEqual([])
    expect(agent.store.rows("sessionInputs", "queue")).toEqual([expect.objectContaining({ id: queued.messageID, queuePosition: 0 })])
    expect(agent.store.rows("sessions").find((row) => row.id === "queue")?.queueRevision).toBe(3)
    expect(steer.messageID).toBeString()
    agent.dispose()
  })

  test("does not stage a steer prompt when its optimistic update throws", () => {
    const agent = createConnectionAgent("http://hena.test", () => new Promise<Response>(() => {}))
    const mutationVersion = getMutationStateVersion()

    expect(() => admitPromptOptimistically(agent, {
      sessionID: "missing",
      text: "Do not orphan",
      delivery: "steer",
    })).toThrow(/not found/)

    expect(agent.localMessages.rows("missing")).toEqual([])
    expect(getMutationStateVersion()).toBe(mutationVersion)
    agent.dispose()
  })
})
