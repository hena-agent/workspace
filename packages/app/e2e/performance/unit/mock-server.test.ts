import { expect, test } from "bun:test"
import type { Page, Route } from "@playwright/test"
import { mockHenaServer } from "../../utils/mock-server"

test("applies message latency after a list response gate is released", async () => {
  const events: string[] = []
  const gate = Promise.withResolvers<void>()
  let handler: ((route: Route) => Promise<void>) | undefined
  const page = {
    route: (_url: string, callback: (route: Route) => Promise<void>) => {
      handler = callback
      return Promise.resolve()
    },
  } as unknown as Page
  await mockHenaServer(page, {
    provider: {},
    directory: "C:/Hena",
    project: {},
    sessions: [{ id: "session" }],
    messageDelay: 25,
    beforeMessagesResponse: () => {
      events.push("before")
      return gate.promise
    },
    onMessages: (request) => events.push(request.phase),
    pageMessages: () => {
      events.push("page")
      return { items: [] }
    },
  })

  const response = handler!({
    request: () => ({ url: () => "http://127.0.0.1:4096/session/session/message" }),
    fulfill: () => {
      events.push("fulfill")
      return Promise.resolve()
    },
  } as unknown as Route)
  expect(events).toEqual(["start", "before"])

  const released = performance.now()
  gate.resolve()
  await response
  expect(performance.now() - released).toBeGreaterThanOrEqual(20)
  expect(events).toEqual(["start", "before", "page", "end", "fulfill"])
})

test("returns project chats as an array", async () => {
  let handler: ((route: Route) => Promise<void>) | undefined
  const page = {
    route: (_url: string, callback: (route: Route) => Promise<void>) => {
      handler = callback
      return Promise.resolve()
    },
  } as unknown as Page
  const responses: unknown[] = []
  const route = {
    request: () => ({ url: () => "http://127.0.0.1:4096/api/project" }),
    fulfill: (response: { body: string }) => {
      responses.push(JSON.parse(response.body))
      return Promise.resolve()
    },
  } as unknown as Route
  const config = {
    provider: {},
    directory: "C:/Hena",
    project: {},
    sessions: [],
    pageMessages: () => ({ items: [] }),
  }

  await mockHenaServer(page, config)
  await handler!(route)
  const chats = [{ id: "project", name: "Chat", directory: "C:/Hena/chat", time: { created: 1, updated: 1 } }]
  await mockHenaServer(page, { ...config, projectChats: chats })
  await handler!(route)

  expect(responses).toEqual([[], chats])
})
