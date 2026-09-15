import { expect, test } from "bun:test"
import { createHenaClient } from "@hena/sdk/v2/client"
import { interruptSession, pendingQuestions, respondToQuestion, usesCanonicalSession } from "./session-runtime"

test("selects execution and history by session ownership, not just Project mode", () => {
  expect(usesCanonicalSession({ metadata: { appRuntime: "legacy" } }, true)).toBe(false)
  expect(usesCanonicalSession({ metadata: { appRuntime: "legacy" } }, false)).toBe(false)
  expect(usesCanonicalSession({ metadata: { appRuntime: "canonical" } }, false)).toBe(true)
  expect(usesCanonicalSession({}, true)).toBe(true)
  expect(usesCanonicalSession({}, false)).toBe(false)
})

test("routes hydrated question actions and Stop to their owning APIs", async () => {
  const sent: { path: string; body?: unknown }[] = []
  const client = createHenaClient({
    baseUrl: "http://test",
    throwOnError: true,
    fetch: (async (request: Request) => {
      const path = new URL(request.url).pathname
      sent.push({ path, body: request.method === "POST" && request.headers.get("content-type") ? await request.json() : undefined })
      if (path === "/question") return Response.json([{ id: "que_legacy", sessionID: "legacy", questions: [] }])
      if (path === "/api/question/request") return Response.json({ data: [{ id: "que_canonical", sessionID: "canonical", questions: [] }] })
      if (path === "/session/canonical") return Response.json({ id: "canonical", metadata: { appRuntime: "canonical" } })
      return path.startsWith("/api/") ? new Response(null, { status: 204 }) : Response.json(true)
    }) as typeof fetch,
  })
  const pending = await pendingQuestions(client, "/attached")
  expect(pending.data.map((question) => question.appRuntime)).toEqual(["legacy", "canonical"])
  for (const question of pending.data) {
    await respondToQuestion(client, question, [["A"]])
    await respondToQuestion(client, question)
  }
  await interruptSession(client, "legacy", { metadata: { appRuntime: "legacy" } })
  await interruptSession(client, "canonical")
  expect(sent).toContainEqual({ path: "/api/session/canonical/question/que_canonical/reply", body: { answers: [["A"]] } })
  expect(sent.map((request) => request.path)).toEqual([
    "/question", "/api/question/request",
    "/question/que_legacy/reply", "/question/que_legacy/reject",
    "/api/session/canonical/question/que_canonical/reply", "/api/session/canonical/question/que_canonical/reject",
    "/session/legacy/abort", "/session/canonical", "/api/session/canonical/interrupt",
  ])
})
