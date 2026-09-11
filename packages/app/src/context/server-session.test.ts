import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { SessionEvent } from "@hena/schema/session-event"
import type { retry } from "@hena/core/util/retry"
import { createHenaClient } from "@hena/sdk/v2/client"
import type { Message, HenaClient, Part, Session, SessionMessage } from "@hena/sdk/v2/client"
import { createServerSession } from "./server-session"
import { usesCanonicalSession } from "./session-runtime"

const session = (id: string, parentID?: string): Session => ({
  id,
  slug: id,
  projectID: "project",
  directory: "/repo",
  title: id,
  version: "1",
  parentID,
  time: { created: 1, updated: 1 },
})

type UserMessage = Extract<Message, { role: "user" }>
type AssistantMessage = Extract<Message, { role: "assistant" }>
type TextPart = Extract<Part, { type: "text" }>
type MessageResponse = {
  data: { info: Message; parts: Part[] }[]
  response: { headers: Headers }
}
type SingleMessageResponse = { data: MessageResponse["data"][number] }

const userMessage = (id: string, input: Partial<UserMessage> = {}): UserMessage => ({
  id,
  sessionID: "child",
  role: "user",
  time: { created: 1 },
  agent: "build",
  model: { providerID: "provider", modelID: "model" },
  ...input,
})

const assistantMessage = (id: string, parentID: string, input: Partial<AssistantMessage> = {}): AssistantMessage => ({
  id,
  sessionID: "child",
  role: "assistant",
  time: { created: Number(id.at(-1)), completed: Number(id.at(-1)) },
  parentID,
  modelID: "model",
  providerID: "provider",
  mode: "build",
  agent: "build",
  path: { cwd: "/repo", root: "/repo" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  ...input,
})

const textPart = (messageID: string, input: Partial<TextPart> = {}): TextPart => ({
  id: "part",
  sessionID: "child",
  messageID,
  type: "text",
  text: "text",
  ...input,
})

const response = (data: MessageResponse["data"] = [], cursor?: string): MessageResponse => ({
  data,
  response: { headers: new Headers(cursor ? { "x-next-cursor": cursor } : undefined) },
})

const singleResponse = (info: Message, parts: Part[] = []): SingleMessageResponse => ({ data: { info, parts } })

function generatedClient(routes: Record<string, unknown>) {
  const requests: string[] = []
  const client = createHenaClient({
    baseUrl: "http://server",
    fetch: (async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      requests.push(`${url.pathname}${url.search}`)
      const body = routes[url.pathname]
      if (body === undefined) throw new Error(`Unexpected request: ${url.pathname}`)
      return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
    }) as typeof fetch,
  })
  return { client, requests }
}

const deferredResponse = () => Promise.withResolvers<MessageResponse>()

function messageClient(...responses: Array<MessageResponse | Promise<MessageResponse>>) {
  let index = 0
  const requests: unknown[] = []
  const waiting = new Map<number, () => void>()
  const client = {
    session: {
      get: async () => ({ data: session("child", "root") }),
      messages: (input: unknown) => {
        requests.push(input)
        waiting.get(requests.length)?.()
        waiting.delete(requests.length)
        return responses[index++]
      },
    },
  } as unknown as HenaClient
  return Object.assign(client, {
    requests,
    requested(count: number) {
      if (requests.length >= count) return Promise.resolve()
      return new Promise<void>((resolve) => waiting.set(count, resolve))
    },
  })
}

function rootMessageClient(
  pages: Array<MessageResponse | Promise<MessageResponse>>,
  roots: Array<SingleMessageResponse | Promise<SingleMessageResponse>>,
) {
  let pageIndex = 0
  let rootIndex = 0
  const requests: unknown[] = []
  const rootRequests: unknown[] = []
  const rootWaiting = new Map<number, () => void>()
  const client = {
    session: {
      get: async () => ({ data: session("child", "root") }),
      messages: (input: unknown) => {
        requests.push(input)
        return pages[pageIndex++]
      },
      message: (input: unknown) => {
        rootRequests.push(input)
        rootWaiting.get(rootRequests.length)?.()
        rootWaiting.delete(rootRequests.length)
        return roots[rootIndex++]
      },
    },
  } as unknown as HenaClient
  return Object.assign(client, {
    requests,
    rootRequests,
    rootRequested(count: number) {
      if (rootRequests.length >= count) return Promise.resolve()
      return new Promise<void>((resolve) => rootWaiting.set(count, resolve))
    },
  })
}

const retryImmediately: typeof retry = async (task, options = {}) => {
  const attempts = options.attempts ?? 3
  for (let attempt = 0; ; attempt++) {
    try {
      return await task()
    } catch (error) {
      if (attempt === attempts - 1) throw error
    }
  }
}

function setup(sessions: Record<string, Session>) {
  const get: unknown[] = []
  const messages: unknown[] = []
  const client = {
    session: {
      get: async (input: unknown) => {
        get.push(input)
        const id = (input as { sessionID: string }).sessionID
        return { data: sessions[id] }
      },
      messages: async (input: unknown) => {
        messages.push(input)
        return response()
      },
      diff: async () => ({ data: [] }),
      todo: async () => ({ data: [] }),
    },
  } as unknown as HenaClient
  return { get, messages, store: createServerSession(client) }
}

describe("server session", () => {
  test("applies canonical revert state before its authoritative refresh completes", () => {
    const id = "ses_child"
    const sessions = { [id]: session(id) }
    const ctx = setup(sessions)
    ctx.store.remember(sessions[id])
    const staged = Schema.decodeUnknownSync(SessionEvent.RevertEvent.Staged.data)({
      sessionID: id,
      timestamp: 1,
      revert: { messageID: "msg_boundary" },
    })

    ctx.store.apply({ type: SessionEvent.RevertEvent.Staged.type, data: staged })
    expect(ctx.store.data.info[id]?.revert).toEqual({ messageID: "msg_boundary" })

    sessions[id] = { ...sessions[id], revert: undefined }
    const committed = Schema.decodeUnknownSync(SessionEvent.RevertEvent.Committed.data)({
      sessionID: id,
      timestamp: 2,
      messageID: "msg_boundary",
      replacement: {
        messageID: "msg_replacement",
        prompt: { text: "replacement" },
        delivery: "steer",
        agent: "build",
        model: { providerID: "provider", id: "model" },
      },
    })
    ctx.store.apply({ type: SessionEvent.RevertEvent.Committed.type, data: committed })

    expect(ctx.store.data.info[id]?.revert).toBeUndefined()
    expect(ctx.store.data.info[id]).toMatchObject({
      agent: "build",
      model: { providerID: "provider", id: "model" },
    })
  })

  test("maps V2 execution status events to the legacy busy store without losing failures", () => {
    const ctx = setup({ child: session("child") })

    ctx.store.apply({
      type: "session.next.execution.status",
      data: { sessionID: "child", status: { type: "running" } },
    })
    expect(ctx.store.data.session_status.child).toEqual({ type: "busy" })

    ctx.store.apply({
      type: "session.next.execution.status",
      data: { sessionID: "child", status: { type: "failed", error: { message: "model unavailable" } } },
    })
    expect(ctx.store.data.session_status.child).toEqual({ type: "idle" })
    expect(ctx.store.data.execution_error.child).toBe("model unavailable")
  })

  test("does not let a reconnect snapshot overwrite a newer live status and clears absent stale work", () => {
    const ctx = setup({ child: session("child"), stale: session("stale") })
    ctx.store.apply({
      type: "session.next.execution.status",
      data: { sessionID: "child", status: { type: "running" } },
    })
    ctx.store.apply({
      type: "session.next.execution.status",
      data: { sessionID: "stale", status: { type: "running" } },
    })
    const token = ctx.store.executionSnapshotToken()
    ctx.store.apply({ type: "session.next.execution.status", data: { sessionID: "child", status: { type: "idle" } } })

    ctx.store.reconcileExecutionSnapshot({ stale: { type: "running" }, child: { type: "running" } }, token)

    expect(ctx.store.data.session_status.child).toEqual({ type: "idle" })
    expect(ctx.store.data.session_status.stale).toEqual({ type: "busy" })
  })

  test("clears a stale busy status when reconnect snapshot omits the session", () => {
    const ctx = setup({ stale: session("stale") })
    ctx.store.apply({
      type: "session.next.execution.status",
      data: { sessionID: "stale", status: { type: "running" } },
    })
    const token = ctx.store.executionSnapshotToken()

    ctx.store.reconcileExecutionSnapshot({}, token)

    expect(ctx.store.data.session_status.stale).toEqual({ type: "idle" })
  })

  test("does not reconcile legacy session status as a V2 execution session", () => {
    const ctx = setup({ legacy: session("legacy") })
    ctx.store.apply({ type: "session.status", properties: { sessionID: "legacy", status: { type: "busy" } } })
    const token = ctx.store.executionSnapshotToken()

    ctx.store.reconcileExecutionSnapshot({}, token)

    expect(ctx.store.data.session_status.legacy).toEqual({ type: "busy" })
  })

  test("projects canonical V2 text, reasoning, and tool stream events incrementally", () => {
    const ctx = setup({ child: session("child") })
    ctx.store.remember(session("child"))
    const user = userMessage("user")
    ctx.store.set("message", "child", [user])

    ctx.store.apply({
      type: "session.next.step.started",
      data: {
        sessionID: "child",
        assistantMessageID: "assistant",
        timestamp: 2,
        agent: "build",
        model: { providerID: "provider", id: "model" },
      },
    })
    ctx.store.apply({
      type: "session.next.text.started",
      data: { sessionID: "child", assistantMessageID: "assistant", timestamp: 2, textID: "text" },
    })
    ctx.store.apply({
      type: "session.next.text.delta",
      data: { sessionID: "child", assistantMessageID: "assistant", timestamp: 2, textID: "text", delta: "hello" },
    })
    expect(ctx.store.data.part.assistant?.[0]).toMatchObject({ type: "text", text: "hello" })

    ctx.store.apply({
      type: "session.next.reasoning.started",
      data: { sessionID: "child", assistantMessageID: "assistant", timestamp: 2, reasoningID: "reasoning" },
    })
    ctx.store.apply({
      type: "session.next.reasoning.delta",
      data: {
        sessionID: "child",
        assistantMessageID: "assistant",
        timestamp: 2,
        reasoningID: "reasoning",
        delta: "think",
      },
    })
    expect(ctx.store.data.part.assistant?.find((part) => part.type === "reasoning")).toMatchObject({
      type: "reasoning",
      text: "think",
    })

    ctx.store.apply({
      type: "session.next.tool.input.started",
      data: { sessionID: "child", assistantMessageID: "assistant", timestamp: 2, callID: "call", name: "read" },
    })
    ctx.store.apply({
      type: "session.next.tool.input.delta",
      data: {
        sessionID: "child",
        assistantMessageID: "assistant",
        timestamp: 2,
        callID: "call",
        delta: '{"path":"a"}',
      },
    })
    ctx.store.apply({
      type: "session.next.tool.called",
      data: {
        sessionID: "child",
        assistantMessageID: "assistant",
        timestamp: 2,
        callID: "call",
        tool: "read",
        input: { path: "a" },
        provider: { executed: false },
      },
    })
    expect(ctx.store.data.part.assistant?.find((part) => part.type === "tool")).toMatchObject({
      type: "tool",
      tool: "read",
      state: { status: "running" },
    })
  })

  test("buffers V2 stream events until canonical history is hydrated", async () => {
    const gate = Promise.withResolvers<unknown>()
    const client = {
      session: {
        get: async () => ({ data: session("child") }),
      },
      v2: {
        session: {
          messages: async () => ({ data: await gate.promise }),
        },
      },
    } as unknown as HenaClient
    const store = createServerSession(client, { managedSession: () => true })

    store.apply({
      type: "session.next.step.started",
      data: {
        sessionID: "child",
        assistantMessageID: "assistant",
        timestamp: 2,
        agent: "build",
        model: { providerID: "provider", id: "model" },
      },
    })
    expect(store.data.message.child).toBeUndefined()

    gate.resolve({
      data: [
        {
          id: "user",
          type: "user",
          time: { created: 1 },
          text: "hello",
        },
      ],
      cursor: {},
    })
    await store.sync("child")

    expect(store.data.message.child?.map((item) => item.id)).toEqual(["assistant", "user"])
  })

  test("discards buffered V2 events when canonical hydration fails", async () => {
    const attempted = Promise.withResolvers<void>()
    let attempts = 0
    const client = {
      session: {
        get: async () => ({ data: session("child") }),
      },
      v2: {
        session: {
          messages: async () => {
            attempts += 1
            if (attempts === 1) {
              attempted.resolve()
              throw new Error("hydration failed")
            }
            return { data: { data: [{ id: "user", type: "user", time: { created: 1 }, text: "hello" }], cursor: {} } }
          },
        },
      },
    } as unknown as HenaClient
    const store = createServerSession(client, { managedSession: () => true, retry: async (task) => task() })

    store.apply({
      type: "session.next.step.started",
      data: {
        sessionID: "child",
        assistantMessageID: "failed-assistant",
        timestamp: 2,
        agent: "build",
        model: { providerID: "provider", id: "model" },
      },
    })
    await attempted.promise
    await Bun.sleep(0)
    store.apply({
      type: "session.next.step.started",
      data: {
        sessionID: "child",
        assistantMessageID: "assistant",
        timestamp: 3,
        agent: "build",
        model: { providerID: "provider", id: "model" },
      },
    })
    await store.sync("child")

    expect(store.data.message.child?.map((item) => item.id)).toEqual(["assistant", "user"])
    expect(attempts).toBe(2)
  })

  test("hydrates managed history through the generated V2 list client", async () => {
    const user = {
      id: "user",
      type: "user",
      time: { created: 1 },
      text: "hello",
    }
    const generated = generatedClient({
      "/session/child": session("child"),
      "/api/session/child/message": { data: [user], cursor: {} },
    })
    const store = createServerSession(generated.client, { managedSession: () => true })

    await store.sync("child")

    expect(generated.requests).toEqual(["/session/child", "/api/session/child/message?limit=20&order=desc"])
    expect(store.data.message.child?.map((item) => item.id)).toEqual(["user"])
  })

  test("retains authoritative runtime through incomplete list and event updates after attachment", async () => {
    const generated = generatedClient({
      "/session/child": { ...session("child"), metadata: { appRuntime: "canonical" } },
      "/api/session/child/message": { data: [{ id: "user", type: "user", time: { created: 1 }, text: "saved" }], cursor: {} },
    })
    const store = createServerSession(generated.client, { managedSession: (item) => usesCanonicalSession(item, false) })
    store.remember(session("child"))
    await store.sync("child")
    expect(generated.requests[0]).toBe("/session/child")
    store.remember({ ...session("child"), title: "listed", metadata: { label: "new" } })
    store.apply({ type: "session.updated", properties: { info: { ...session("child"), title: "event" } } })
    expect(store.get("child")?.metadata?.appRuntime).toBe("canonical")
    store.remember({ ...session("child"), metadata: { appRuntime: "legacy" } })
    expect(store.get("child")?.metadata?.appRuntime).toBe("canonical")
    await store.sync("child", { force: true })
    expect(store.timeline("child").map((message) => message.id)).toEqual(["user"])
    expect(generated.requests.some((url) => url.startsWith("/session/child/message"))).toBe(false)
  })

  test("uses the existing question store for canonical asked, replied, and interrupted events", () => {
    const generated = generatedClient({})
    const store = createServerSession(generated.client)
    store.remember({ ...session("child"), metadata: { appRuntime: "canonical" } })
    const question = { id: "que_pending", sessionID: "child", questions: [{ question: "Pick", header: "Choice", options: [] }] }
    for (const type of ["question.v2.replied", "question.v2.rejected"]) {
      store.apply({ type: "question.v2.asked", data: question })
      const expected = { ...question, appRuntime: "canonical" }
      expect(store.data.question.child).toEqual([expected])
      store.apply({ type, data: { sessionID: "child", requestID: question.id } })
      expect(store.data.question.child).toEqual([])
    }
  })

  test("keeps mixed migrated and canonical message IDs in server sequence order", async () => {
    const first = {
      id: "msg_fa30157fc00125kydn4AhAV5Up",
      type: "user",
      time: { created: 1 },
      text: "first",
    } satisfies Extract<SessionMessage, { type: "user" }>
    const second = {
      id: "msg_0800ad7bf001S6PWTI5wjHdtXS",
      type: "user",
      time: { created: 1 },
      text: "second",
    } satisfies Extract<SessionMessage, { type: "user" }>
    const firstAssistant = {
      id: "msg_fa3010000001firstAssistant",
      type: "assistant",
      time: { created: 1, completed: 1 },
      agent: "build",
      model: { providerID: "provider", id: "model" },
      content: [],
    } satisfies Extract<SessionMessage, { type: "assistant" }>
    const secondAssistant = {
      id: "msg_0800ad7bf002secondAssistant",
      type: "assistant",
      time: { created: 1, completed: 1 },
      agent: "build",
      model: { providerID: "provider", id: "model" },
      content: [],
    } satisfies Extract<SessionMessage, { type: "assistant" }>
    const liveAssistant = {
      ...secondAssistant,
      id: "msg_0800ad7bf003liveAssistant",
    }
    const routes: Record<string, unknown> = {
      "/session/child": session("child"),
      "/api/session/child/message": { data: [first], cursor: {} },
    }
    const generated = generatedClient(routes)
    const store = createServerSession(generated.client, { managedSession: () => true })
    await store.sync("child")

    store.optimistic.add({
      sessionID: "child",
      message: userMessage(second.id, { time: { created: 1 } }),
      parts: [],
    })

    expect(store.timeline("child").filter((item) => item.role === "user").map((item) => item.id)).toEqual([
      first.id,
      second.id,
    ])

    routes["/api/session/child/message"] = {
      data: [secondAssistant, second, firstAssistant, first],
      cursor: {},
    }
    await store.sync("child", { force: true })
    expect(store.data.message.child?.map((item) => item.id)).toEqual(
      store.data.message.child?.map((item) => item.id).toSorted(),
    )
    expect(store.timeline("child").map((item) => item.id)).toEqual([
      first.id,
      firstAssistant.id,
      second.id,
      secondAssistant.id,
    ])
    expect(store.timeline("child").at(-2)).toBe(store.data.message.child?.find((item) => item.id === second.id))

    routes["/api/session/child/message"] = {
      data: [liveAssistant, secondAssistant, second, firstAssistant, first],
      cursor: {},
    }
    store.apply({
      type: "session.next.step.started",
      data: {
        sessionID: "child",
        assistantMessageID: liveAssistant.id,
        timestamp: 1,
        agent: "build",
        model: { providerID: "provider", id: "model" },
      },
    })
    expect(store.timeline("child").filter((item) => item.role === "user").at(-1)?.id).toBe(second.id)
    expect(store.timeline("child").find((item) => item.id === liveAssistant.id)).toMatchObject({ parentID: second.id })

    await store.sync("child", { force: true })
    await store.sync("child", { force: true })
    expect(store.timeline("child").filter((item) => item.role === "user").at(-1)?.id).toBe(second.id)
  })

  test("reconciles managed canonical prompt parts with different IDs", async () => {
    const message = userMessage("message")
    const source = { type: "file" as const, path: "/repo/report.txt", text: { value: "report", start: 1, end: 7 } }
    const optimistic: Part[] = [
      textPart(message.id, { id: "part_01_text", text: "inspect" }),
      textPart(message.id, { id: "part_02_context", text: "context note", synthetic: true }),
      {
        id: "part_03_file",
        sessionID: "child",
        messageID: message.id,
        type: "file",
        url: "file:///repo/report.txt",
        mime: "text/plain",
        filename: "report.txt",
        source,
      },
      {
        id: "part_04_agent",
        sessionID: "child",
        messageID: message.id,
        type: "agent",
        name: "reviewer",
        source: { value: "reviewer", start: 8, end: 16 },
      },
      {
        id: "part_05_pending",
        sessionID: "child",
        messageID: message.id,
        type: "file",
        url: "file:///repo/pending.txt",
        mime: "text/plain",
        filename: "pending.txt",
      },
    ]
    const canonical = {
      id: message.id,
      type: "user",
      time: { created: 2 },
      text: "inspect\ncontext note",
      files: [
        {
          uri: "file:///repo/report.txt",
          mime: "text/plain",
          name: "report.txt",
          source: { text: "report", start: 1, end: 7 },
        },
      ],
      agents: [{ name: "reviewer", source: { text: "reviewer", start: 8, end: 16 } }],
    } satisfies Extract<SessionMessage, { type: "user" }>
    const routes: Record<string, unknown> = {
      "/session/child": session("child"),
      "/api/session/child/message": { data: [canonical], cursor: {} },
    }
    const generated = generatedClient(routes)
    const store = createServerSession(generated.client, { managedSession: () => true })
    store.optimistic.add({ sessionID: "child", message, parts: optimistic })

    await store.sync("child")

    expect(store.data.message.child?.[0]?.time.created).toBe(2)
    expect(store.data.part[message.id]?.map((part) => part.id)).toEqual([
      "message:agent:0",
      "message:file:0",
      "message:text",
      "part_05_pending",
    ])
    expect(store.data.part[message.id]?.find((part) => part.id === "message:file:0")).toMatchObject({
      type: "file",
      url: "file:///repo/report.txt",
      source: { text: { value: "report", start: 1, end: 7 } },
    })

    store.optimistic.remove({ sessionID: "child", messageID: message.id })
    expect(store.data.part[message.id]?.map((part) => part.id)).toEqual([
      "message:agent:0",
      "message:file:0",
      "message:text",
    ])

    routes["/api/session/child/message"] = {
      data: [{ ...canonical, text: "authoritative update", time: { created: 3 } }],
      cursor: {},
    }
    await store.sync("child", { force: true })
    expect(store.data.part[message.id]?.map((part) => part.id)).toEqual([
      "message:agent:0",
      "message:file:0",
      "message:text",
    ])
    expect(store.data.part[message.id]?.find((part) => part.type === "text")).toMatchObject({
      id: "message:text",
      text: "authoritative update",
    })

  })

  test("clears confirmed joined optimistic text before a later canonical update", async () => {
    const message = userMessage("message")
    const canonical = {
      id: message.id,
      type: "user",
      time: { created: 2 },
      text: "question\ncontext note",
    } satisfies Extract<SessionMessage, { type: "user" }>
    const routes: Record<string, unknown> = {
      "/session/child": session("child"),
      "/api/session/child/message": { data: [canonical], cursor: {} },
    }
    const generated = generatedClient(routes)
    const store = createServerSession(generated.client, { managedSession: () => true })
    store.optimistic.add({
      sessionID: "child",
      message,
      parts: [
        textPart(message.id, { id: "part_01_text", text: "question" }),
        textPart(message.id, { id: "part_02_context", text: "context note", synthetic: true }),
      ],
    })
    await store.sync("child")

    routes["/api/session/child/message"] = {
      data: [{ ...canonical, text: "authoritative update", time: { created: 3 } }],
      cursor: {},
    }
    await store.sync("child", { force: true })

    expect(store.data.part[message.id]).toMatchObject([
      { id: "message:text", type: "text", text: "authoritative update" },
    ])
  })

  test("streams into a hydrated assistant without step started and keeps canonical metadata", async () => {
    const assistant = {
      id: "assistant",
      type: "assistant",
      time: { created: 2, completed: 9 },
      agent: "review",
      model: { providerID: "provider", id: "model", variant: "precise" },
      content: [],
      finish: "stop",
      cost: 4,
      tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
    } satisfies Extract<SessionMessage, { type: "assistant" }>
    const generated = generatedClient({
      "/session/child": session("child"),
      "/api/session/child/message": {
        data: [assistant, { id: "user", type: "user", time: { created: 1 }, text: "hello" }],
        cursor: {},
      },
    })
    const store = createServerSession(generated.client, { managedSession: () => true })
    await store.sync("child")

    store.apply({
      type: "session.next.text.started",
      data: { sessionID: "child", assistantMessageID: assistant.id, timestamp: 3, textID: "text" },
    })
    store.apply({
      type: "session.next.text.delta",
      data: { sessionID: "child", assistantMessageID: assistant.id, timestamp: 3, textID: "text", delta: "answer" },
    })
    store.apply({
      type: "session.next.reasoning.started",
      data: { sessionID: "child", assistantMessageID: assistant.id, timestamp: 3, reasoningID: "reasoning" },
    })
    store.apply({
      type: "session.next.reasoning.delta",
      data: {
        sessionID: "child",
        assistantMessageID: assistant.id,
        timestamp: 3,
        reasoningID: "reasoning",
        delta: "thought",
      },
    })
    store.apply({
      type: "session.next.tool.input.started",
      data: { sessionID: "child", assistantMessageID: assistant.id, timestamp: 3, callID: "call" },
    })
    store.apply({
      type: "session.next.tool.called",
      data: {
        sessionID: "child",
        assistantMessageID: assistant.id,
        timestamp: 4,
        callID: "call",
        tool: "read",
        input: { path: "a" },
      },
    })
    store.apply({
      type: "session.next.step.started",
      data: {
        sessionID: "child",
        assistantMessageID: assistant.id,
        timestamp: 3,
        agent: "build",
        model: { providerID: "other", id: "other" },
      },
    })

    expect(store.data.part[assistant.id]).toMatchObject([
      { id: "call", type: "tool", tool: "read", state: { status: "running", input: { path: "a" } } },
      { id: "reasoning", type: "reasoning", text: "thought" },
      { id: "text", type: "text", text: "answer" },
    ])
    expect(store.data.message.child?.find((message) => message.id === assistant.id)).toMatchObject({
      time: { created: 2, completed: 9 },
      agent: "review",
      modelID: "model",
      providerID: "provider",
      variant: "precise",
      finish: "stop",
      cost: 4,
      tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
    })

    store.remember(session("other"))
    store.set("message", "other", [userMessage("other-user", { sessionID: "other" })])
    store.apply({
      type: "session.next.text.started",
      data: { sessionID: "other", assistantMessageID: assistant.id, timestamp: 3, textID: "wrong-session" },
    })
    expect(store.data.part[assistant.id]?.some((part) => part.id === "wrong-session")).toBe(false)
  })

  test("waits for project mode before choosing managed history", async () => {
    const mode = Promise.withResolvers<boolean>()
    const requested = Promise.withResolvers<void>()
    const calls: string[] = []
    const client = {
      session: {
        get: async () => ({ data: session("child") }),
        messages: async () => {
          calls.push("legacy")
          return response([{ info: userMessage("legacy"), parts: [] }])
        },
      },
      v2: {
        session: {
          messages: async () => {
            calls.push("managed")
            return {
              data: { data: [{ id: "managed", type: "user", time: { created: 1 }, text: "hello" }], cursor: {} },
            }
          },
        },
      },
    } as unknown as HenaClient
    const store = createServerSession(client, {
      managedSession: async () => {
        requested.resolve()
        return mode.promise
      },
    })

    const syncing = store.sync("child")
    await requested.promise
    expect(calls).toEqual([])
    mode.resolve(true)
    await syncing
    await store.sync("child")

    expect(calls).toEqual(["managed"])
    expect(store.data.message.child?.map((message) => message.id)).toEqual(["managed"])
  })

  test("maps a typed mixed V2 history without treating control metadata as user content", async () => {
    const history = [
      { id: "01-agent", type: "agent-switched", time: { created: 1 }, agent: "explore" },
      { id: "02-model", type: "model-switched", time: { created: 2 }, model: { providerID: "p2", id: "m2" } },
      {
        id: "03-user",
        type: "user",
        time: { created: 3 },
        text: "inspect the attachment",
        files: [
          {
            uri: "file:///tmp/report.txt",
            mime: "text/plain",
            name: "report.txt",
            source: { start: 4, end: 10, text: "report" },
          },
        ],
        agents: [{ name: "reviewer", source: { start: 11, end: 19, text: "reviewer" } }],
      },
      {
        id: "04-assistant",
        type: "assistant",
        time: { created: 4, completed: 5 },
        agent: "explore",
        model: { providerID: "p2", id: "m2", variant: "fast" },
        content: [
          { id: "04-text", type: "text", text: "I found it." },
          { id: "04-reasoning", type: "reasoning", text: "Looking at the file.", time: { created: 4, completed: 4 } },
          {
            id: "04-pending",
            type: "tool",
            name: "pending",
            time: { created: 4 },
            state: { status: "pending", input: "{}" },
          },
          {
            id: "04-running",
            type: "tool",
            name: "running",
            time: { created: 4, ran: 4 },
            state: { status: "running", input: {}, structured: {}, content: [] },
          },
          {
            id: "04-completed",
            type: "tool",
            name: "completed",
            time: { created: 4, ran: 4, completed: 5 },
            state: { status: "completed", input: {}, structured: {}, content: [], result: "ok" },
          },
          {
            id: "04-error",
            type: "tool",
            name: "error",
            time: { created: 4, ran: 4, completed: 5 },
            state: {
              status: "error",
              input: {},
              structured: {},
              content: [],
              error: { type: "unknown", message: "failed" },
            },
          },
        ],
      },
      { id: "05-synthetic", type: "synthetic", time: { created: 5 }, sessionID: "child", text: "internal" },
      { id: "06-system", type: "system", time: { created: 6 }, text: "internal" },
      {
        id: "07-shell",
        type: "shell",
        time: { created: 7, completed: 8 },
        callID: "shell",
        command: "pwd",
        output: "/repo",
      },
      {
        id: "08-compaction",
        type: "compaction",
        reason: "manual",
        summary: "Earlier context",
        recent: "Keep going",
        time: { created: 8 },
      },
      { id: "09-user", type: "user", time: { created: 9 }, text: "continue" },
      {
        id: "10-assistant",
        type: "assistant",
        time: { created: 10, completed: 11 },
        agent: "explore",
        model: { providerID: "p2", id: "m2" },
        content: [{ id: "10-text", type: "text", text: "Done." }],
      },
    ] satisfies SessionMessage[]
    const generated = generatedClient({
      "/session/child": session("child"),
      "/api/session/child/message": { data: [...history].reverse(), cursor: {} },
    })
    const store = createServerSession(generated.client, { managedSession: () => true })

    await store.sync("child")

    expect(store.data.message.child?.map((item) => item.id)).toEqual([
      "03-user",
      "04-assistant",
      "07-shell",
      "08-compaction",
      "09-user",
      "10-assistant",
    ])
    expect(store.data.message.child?.[1]).toMatchObject({ parentID: "03-user", agent: "explore", modelID: "m2" })
    expect(store.data.message.child?.[5]).toMatchObject({ parentID: "09-user" })
    expect(store.data.part["03-user"]?.find((part) => part.type === "text")).toMatchObject({
      text: "inspect the attachment",
    })
    expect(store.data.part["03-user"]?.find((part) => part.type === "file")).toMatchObject({
      url: "file:///tmp/report.txt",
      filename: "report.txt",
      source: { type: "file", path: "file:///tmp/report.txt", text: { value: "report", start: 4, end: 10 } },
    })
    expect(store.data.part["03-user"]?.find((part) => part.type === "agent")).toMatchObject({
      name: "reviewer",
      source: { value: "reviewer", start: 11, end: 19 },
    })
    expect(store.data.part["03-user"]?.every((part) => part.type !== "file" || part.url.length > 0)).toBe(true)
    expect(store.data.part["07-shell"]?.find((part) => part.type === "text")).toMatchObject({ text: "pwd\n/repo" })
    expect(store.data.part["08-compaction"]).toMatchObject([
      { type: "compaction", auto: false },
      { type: "text", text: "Earlier context", synthetic: true },
    ])
    expect(store.data.part["04-assistant"]?.map((part) => part.type).sort()).toEqual([
      "reasoning",
      "text",
      "tool",
      "tool",
      "tool",
      "tool",
    ])
  })

  test("backfills managed history through the generated V2 single-message client", async () => {
    const assistant: Extract<SessionMessage, { type: "assistant" }> = {
      id: "message-2",
      type: "assistant",
      time: { created: 2, completed: 2 },
      model: { providerID: "provider", id: "model" },
      agent: "build",
      content: [],
    }
    const user: Extract<SessionMessage, { type: "user" }> = {
      id: "message-1",
      type: "user",
      time: { created: 1 },
      text: "hello",
    }
    const generated = generatedClient({
      "/session/child": session("child"),
      "/api/session/child/message": { data: [assistant, user], cursor: {} },
    })
    const store = createServerSession(generated.client, { managedSession: () => true })

    await store.sync("child")

    expect(generated.requests).toEqual(["/session/child", "/api/session/child/message?limit=20&order=desc"])
    expect(store.data.message.child?.map((item) => item.id)).toEqual(["message-1", "message-2"])
  })

  test("continues managed history past control-only pages", async () => {
    const user: Extract<SessionMessage, { type: "user" }> = {
      id: "message-1",
      type: "user",
      time: { created: 1 },
      text: "hello",
    }
    const assistant: Extract<SessionMessage, { type: "assistant" }> = {
      id: "message-2",
      type: "assistant",
      time: { created: 2 },
      model: { providerID: "provider", id: "model" },
      agent: "build",
      content: [],
    }
    const control: Extract<SessionMessage, { type: "agent-switched" }> = {
      id: "control",
      type: "agent-switched",
      time: { created: 3 },
      agent: "build",
    }
    const requests: unknown[] = []
    const client = {
      session: { get: async () => ({ data: session("child") }) },
      v2: {
        session: {
          messages: async (input: unknown) => {
            requests.push(input)
            return requests.length === 1
              ? { data: { data: Array.from({ length: 20 }, (_, index) => ({ ...control, id: `control-${index}` })), cursor: { next: "older" } } }
              : { data: { data: [assistant, user], cursor: {} } }
          },
        },
      },
    } as unknown as HenaClient
    const store = createServerSession(client, { managedSession: () => true })

    await store.sync("child")

    expect(requests).toEqual([
      { sessionID: "child", limit: 20, order: "desc", cursor: undefined },
      { sessionID: "child", limit: 20, order: undefined, cursor: "older" },
    ])
    expect(store.data.message.child?.map((item) => item.id)).toEqual(["message-1", "message-2"])
    expect(store.data.message.child?.[1]).toMatchObject({ parentID: "message-1" })
  })

  test("fetches preceding canonical users across page boundaries and controls despite timestamp ties", async () => {
    const assistant = (id: string): SessionMessage => ({
      id, type: "assistant", time: { created: 1 }, agent: "build",
      model: { providerID: "provider", id: "model" }, content: [],
    })
    const pages: SessionMessage[][] = [
      [assistant("msg_a_latest"), { id: "msg_z_new_user", type: "user", time: { created: 1 }, text: "new" }, assistant("msg_b_older")],
      [
        { id: "control-system", type: "system", time: { created: 1 }, text: "internal" },
        { id: "control-summary", type: "compaction", time: { created: 1 }, reason: "auto", summary: "summary", recent: "recent" },
        { id: "control-agent", type: "agent-switched", time: { created: 1 }, agent: "build" },
      ],
      [{ id: "msg_y_original", type: "user", time: { created: 1 }, text: "original" }],
    ]
    const calls: string[] = []
    const client = createHenaClient({
      baseUrl: "http://server",
      fetch: (async (request: Request) => {
        const url = new URL(request.url)
        if (url.pathname === "/session/child") return Response.json(session("child"))
        calls.push(url.search)
        const data = pages[calls.length - 1]
        if (!data) throw new Error("Fetched past the short terminal page")
        // Older servers emit a cursor even on a short terminal page.
        return Response.json({ data, cursor: { next: `page-${calls.length}` } })
      }) as typeof fetch,
    })
    const store = createServerSession(client, { managedSession: () => true })
    await store.sync("child", { messageLimit: 3 })
    expect(calls).toEqual(["?limit=3&order=desc", "?limit=3&cursor=page-1", "?limit=3&cursor=page-2"])
    expect(store.timeline("child").filter((message) => message.role === "assistant").map((message) => message.parentID))
      .toEqual(["msg_y_original", "msg_z_new_user"])
    expect(store.history.more("child")).toBe(false)
  })

  test("keeps live reasoning, text, and named pending questions in event order, not ID order", async () => {
    const generated = generatedClient({
      "/session/child": session("child"),
      "/api/session/child/message": { data: [{ id: "user", type: "user", time: { created: 1 }, text: "ask" }], cursor: {} },
    })
    const store = createServerSession(generated.client, { managedSession: () => true })
    await store.sync("child")
    store.apply({ type: "session.next.step.started", data: {
      sessionID: "child", assistantMessageID: "assistant", timestamp: 2, agent: "build", model: { providerID: "provider", id: "model" },
    } })
    store.apply({ type: "session.next.reasoning.started", data: {
      sessionID: "child", assistantMessageID: "assistant", timestamp: 2, reasoningID: "rs_reasoning",
    } })
    store.apply({ type: "session.next.text.started", data: {
      sessionID: "child", assistantMessageID: "assistant", timestamp: 2, textID: "msg_text",
    } })
    store.apply({ type: "session.next.tool.input.started", data: {
      sessionID: "child", assistantMessageID: "assistant", callID: "call_question", timestamp: 2, name: "question",
    } })
    expect(store.data.part.assistant?.[0]).toMatchObject({ tool: "question", state: { status: "pending" } })
    expect(store.data.part.assistant?.map((part) => part.id)).toEqual(["call_question", "msg_text", "rs_reasoning"])
    expect(store.parts("assistant")?.map((part) => part.id)).toEqual(["rs_reasoning", "msg_text", "call_question"])
    store.apply({ type: "session.next.text.delta", data: {
      sessionID: "child", assistantMessageID: "assistant", textID: "msg_text", delta: "answer",
    } })
    expect(store.parts("assistant")?.[1]).toMatchObject({ id: "msg_text", text: "answer" })
  })

  test("preserves persisted canonical content order and order-only refreshes without changing lookup indexes", async () => {
    const content: Extract<SessionMessage, { type: "assistant" }>["content"] = [
      { type: "reasoning", id: "rs_reasoning", text: "thinking" },
      { type: "text", id: "msg_text", text: "answer" },
      {
        type: "tool", id: "call_question", name: "question", time: { created: 1, completed: 1 },
        state: { status: "completed", input: {}, structured: {}, content: [{ type: "text", text: "answered" }] },
      },
    ]
    const assistant: Extract<SessionMessage, { type: "assistant" }> = {
      id: "assistant", type: "assistant", agent: "build", model: { providerID: "provider", id: "model" },
      time: { created: 1 }, content,
    }
    const routes = {
      "/session/child": session("child"),
      "/api/session/child/message": { data: [assistant, { id: "user", type: "user", time: { created: 1 }, text: "ask" }], cursor: {} },
    }
    const generated = generatedClient(routes)
    const store = createServerSession(generated.client, { managedSession: () => true })
    await store.sync("child")
    expect(store.parts("assistant")?.map((part) => part.type)).toEqual(["reasoning", "text", "tool"])
    expect(store.parts("assistant")?.[2]).toMatchObject({ tool: "question" })
    const indexed = store.data.part.assistant?.map((part) => part.id)
    assistant.content = [content[0], content[2], content[1]]
    await store.sync("child", { force: true })
    expect(store.parts("assistant")?.map((part) => part.id)).toEqual(["rs_reasoning", "call_question", "msg_text"])
    expect(store.data.part.assistant?.map((part) => part.id)).toEqual(indexed)
    store.evict("child")
    expect(store.data.part_order.assistant).toBeUndefined()
  })

  test("stops at a full terminal canonical page without inventing a cached user parent or fetching an empty page", async () => {
    const generated = generatedClient({
      "/session/child": session("child"),
      "/api/session/child/message": { data: [
        { id: "assistant", type: "assistant", time: { created: 10 }, agent: "build", model: { providerID: "provider", id: "model" }, content: [] },
        { id: "control", type: "system", time: { created: 1 }, text: "not a user" },
      ], cursor: {} },
    })
    const store = createServerSession(generated.client, { managedSession: () => true })
    store.apply({ type: "message.updated", properties: { info: userMessage("cached", { time: { created: 1 } }) } })
    await store.sync("child", { force: true, messageLimit: 2 })
    expect(store.timeline("child")).toMatchObject([{ role: "assistant", parentID: "" }])
    expect(store.history.more("child")).toBe(false)
    await store.history.loadMore("child", 2)
    expect(generated.requests.filter((url) => url.startsWith("/api/session/child/message"))).toHaveLength(1)
  })

  test("caps canonical transport pages when a retained turn window exceeds the API limit", async () => {
    const generated = generatedClient({
      "/session/child": session("child"),
      "/api/session/child/message": { data: [{ id: "user", type: "user", time: { created: 1 }, text: "ask" }], cursor: {} },
    })
    const store = createServerSession(generated.client, { managedSession: () => true })
    await store.sync("child", { messageLimit: 250 })
    expect(generated.requests).toContain("/api/session/child/message?limit=200&order=desc")
  })

  test("preserves older canonical history by sequence rather than tied timestamps and lexical IDs", async () => {
    const assistant = (id: string): SessionMessage => ({
      id, type: "assistant", time: { created: 1 }, agent: "build", model: { providerID: "provider", id: "model" }, content: [],
    })
    const older: SessionMessage[] = [
      assistant("msg_z_old_assistant"), { id: "msg_z_old_user", type: "user", time: { created: 1 }, text: "old" },
    ]
    const latest: SessionMessage[] = [
      assistant("msg_b_new_assistant"), { id: "msg_a_new_user", type: "user", time: { created: 1 }, text: "new" },
    ]
    const page: { data: SessionMessage[]; cursor: { next?: string } } = {
      data: [...latest, ...older], cursor: {},
    }
    const generated = generatedClient({ "/session/child": session("child"), "/api/session/child/message": page })
    const store = createServerSession(generated.client, { managedSession: () => true })
    await store.sync("child")
    page.data = latest
    page.cursor = { next: "older" }
    await store.sync("child", { force: true, messageLimit: 2 })
    expect(store.data.message.child?.map((message) => message?.id)).toStrictEqual([
      "msg_a_new_user", "msg_b_new_assistant", "msg_z_old_assistant", "msg_z_old_user",
    ])
    expect(store.timeline("child").map((message) => message.id)).toEqual([
      "msg_z_old_user", "msg_z_old_assistant", "msg_a_new_user", "msg_b_new_assistant",
    ])
  })

  test("retains live canonical part order while an older snapshot is loading", async () => {
    const started = Promise.withResolvers<void>()
    const refresh = Promise.withResolvers<Response>()
    const history = {
      data: [
        { id: "assistant", type: "assistant", agent: "build", model: { providerID: "provider", id: "model" }, time: { created: 1 }, content: [] },
        { id: "user", type: "user", time: { created: 1 }, text: "ask" },
      ], cursor: {},
    }
    let reads = 0
    const client = createHenaClient({
      baseUrl: "http://server",
      fetch: (async (request: Request) => {
        if (new URL(request.url).pathname === "/session/child") return Response.json(session("child"))
        if (++reads === 1) return Response.json(history)
        started.resolve()
        return refresh.promise
      }) as typeof fetch,
    })
    const store = createServerSession(client, { managedSession: () => true })
    await store.sync("child")
    const loading = store.sync("child", { force: true })
    await started.promise
    const data = { sessionID: "child", assistantMessageID: "assistant", timestamp: 2 }
    store.apply({ type: "session.next.reasoning.started", data: { ...data, reasoningID: "rs_reasoning" } })
    store.apply({ type: "session.next.text.started", data: { ...data, textID: "msg_text" } })
    store.apply({ type: "session.next.tool.input.started", data: { ...data, callID: "call_question", name: "question" } })
    refresh.resolve(Response.json({
      ...history,
      data: [{ ...history.data[0], content: [{ type: "reasoning", id: "rs_reasoning", text: "" }] }, history.data[1]],
    }))
    await loading
    expect(store.parts("assistant")?.map((part) => part.id)).toEqual(["rs_reasoning", "msg_text", "call_question"])
    expect(store.parts("assistant")?.[2]).toMatchObject({ tool: "question", state: { status: "pending" } })
  })

  test("keeps legacy history on the legacy endpoint when a V2 client is available", async () => {
    const calls: string[] = []
    const client = {
      session: {
        get: async () => ({ data: session("child") }),
        messages: async () => {
          calls.push("legacy")
          return response([{ info: userMessage("user"), parts: [] }])
        },
      },
      v2: {
        session: {
          messages: async () => {
            calls.push("v2")
            return { data: { data: [], cursor: {} } }
          },
          message: async () => {
            calls.push("v2-message")
            return { data: undefined }
          },
        },
      },
    } as unknown as HenaClient
    const store = createServerSession(client, { managedSession: () => false })

    await store.sync("child")

    expect(calls).toEqual(["legacy"])
    expect(store.data.message.child?.map((item) => item.id)).toEqual(["user"])
    expect(store.timeline("child")).toEqual(store.data.message.child)
  })

  test("keeps workspace history in legacy endpoint order across ID generations", async () => {
    const migrated = userMessage("msg_fa30157fc00125kydn4AhAV5Up", { time: { created: 1 } })
    const current = userMessage("msg_0800ad7bf001S6PWTI5wjHdtXS", { time: { created: 2 } })
    const store = createServerSession(
      messageClient(
        response([
          { info: migrated, parts: [] },
          { info: current, parts: [] },
        ]),
      ),
    )

    await store.sync("child")

    expect(store.data.message.child?.map((message) => message.id)).toEqual([current.id, migrated.id])
    expect(store.timeline("child").map((message) => message.id)).toEqual([migrated.id, current.id])
  })

  test("orders a message SSE between consecutive optimistic sends", async () => {
    const migrated = userMessage("msg_fa30157fc00125kydn4AhAV5Up", { time: { created: 1 } })
    const first = userMessage("msg_0800ad7bf001S6PWTI5wjHdtXS", { time: { created: 2 } })
    const streamed = assistantMessage("msg_1a0800ad7c001streamed", first.id, { time: { created: 3 } })
    const second = userMessage("msg_0800b4125001dJoBn2djFCaoph", { time: { created: 4 } })
    const store = createServerSession(messageClient(response([{ info: migrated, parts: [] }])))
    await store.sync("child")

    store.optimistic.add({ sessionID: "child", message: first, parts: [] })
    store.apply({ type: "message.updated", properties: { info: streamed } })
    store.optimistic.add({ sessionID: "child", message: second, parts: [] })

    expect(store.timeline("child").map((message) => message.id)).toEqual([
      migrated.id,
      first.id,
      streamed.id,
      second.id,
    ])
    expect(store.data.message.child?.map((message) => message.id)).toEqual(
      store.data.message.child?.map((message) => message.id).toSorted(),
    )
  })

  test("keeps mirrored canonical events out of workspace history", async () => {
    const firstUser = userMessage("message-1")
    const firstAssistant = assistantMessage("message-2", firstUser.id)
    const nextUser = userMessage("message-3", { time: { created: 3 } })
    const nextAssistant = assistantMessage("message-4", nextUser.id)
    const part = textPart(nextAssistant.id, { id: "part-4", text: "answer" })
    const requests: unknown[] = []
    const client = {
      session: {
        get: async () => ({ data: session("child") }),
        messages: async (input: unknown) => {
          requests.push(input)
          return response(
            requests.length === 1
              ? [
                  { info: firstUser, parts: [] },
                  { info: firstAssistant, parts: [] },
                ]
              : [
                  { info: firstUser, parts: [] },
                  { info: firstAssistant, parts: [] },
                  { info: nextUser, parts: [] },
                  { info: nextAssistant, parts: [{ ...part, text: "answer next" }] },
                ],
          )
        },
      },
    } as unknown as HenaClient
    const store = createServerSession(client, { managedSession: () => false })
    await store.sync("child")

    store.apply({
      type: "session.next.step.started",
      data: {
        sessionID: "child",
        assistantMessageID: nextAssistant.id,
        timestamp: 4,
        agent: "build",
        model: { providerID: "provider", id: "model" },
      },
    })
    expect(store.data.message.child).toEqual([firstUser, firstAssistant])
    store.apply({ type: "message.updated", properties: { info: nextUser } })
    store.apply({ type: "message.updated", properties: { info: nextAssistant } })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part, time: 4 } })
    store.apply({
      type: "session.next.text.delta",
      data: {
        sessionID: "child",
        assistantMessageID: nextAssistant.id,
        textID: part.id,
        delta: " next",
      },
    })
    store.apply({
      type: "message.part.delta",
      properties: {
        sessionID: "child",
        messageID: nextAssistant.id,
        partID: part.id,
        field: "text",
        delta: " next",
      },
    })
    store.apply({
      type: "session.next.step.ended",
      data: {
        sessionID: "child",
        assistantMessageID: nextAssistant.id,
        timestamp: 5,
        finish: "stop",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    })
    await Promise.resolve()

    expect(store.data.message.child).toEqual([firstUser, firstAssistant, nextUser, nextAssistant])
    expect(store.data.part[nextAssistant.id]).toEqual([{ ...part, text: "answer next" }])
    expect(requests).toEqual([{ sessionID: "child", limit: 20, before: undefined }])
  })

  test("finalizes a V2 assistant from the step-ended event", () => {
    const ctx = setup({ child: session("child") })
    ctx.store.remember(session("child"))
    ctx.store.set("message", "child", [userMessage("user")])
    ctx.store.apply({
      type: "session.next.step.started",
      data: {
        sessionID: "child",
        assistantMessageID: "assistant",
        timestamp: 2,
        agent: "build",
        model: { providerID: "provider", id: "model" },
      },
    })
    ctx.store.apply({
      type: "session.next.step.ended",
      data: {
        sessionID: "child",
        assistantMessageID: "assistant",
        timestamp: 3,
        finish: "stop",
        cost: 1.5,
        tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
      },
    })

    expect(ctx.store.data.message.child?.find((item) => item.id === "assistant")).toMatchObject({
      time: { completed: 3 },
      cost: 1.5,
      finish: "stop",
      tokens: { input: 1, output: 2, reasoning: 3 },
    })
  })

  test("resolves lineage by session ID without directory", async () => {
    const ctx = setup({ child: session("child", "root"), root: session("root") })

    const result = await ctx.store.lineage.resolve("child")

    expect(result.root.id).toBe("root")
    expect(ctx.get).toEqual([{ sessionID: "child" }, { sessionID: "root" }])
    expect(ctx.store.lineage.peek("child")).toEqual(result)
  })

  test("loads session content through the server client", async () => {
    const ctx = setup({ root: session("root") })

    await ctx.store.sync("root")

    expect(ctx.get).toEqual([{ sessionID: "root" }])
    expect(ctx.messages).toEqual([{ sessionID: "root", limit: 20, before: undefined }])
    expect(ctx.store.data.message.root).toEqual([])
  })

  test("backfills an assistant-only initial page through its user root", async () => {
    const user = userMessage("message-1")
    const assistants = [assistantMessage("message-2", user.id), assistantMessage("message-3", user.id)]
    const client = rootMessageClient(
      [
        response(
          assistants.map((info) => ({ info, parts: [] })),
          "older",
        ),
      ],
      [singleResponse(user)],
    )
    const store = createServerSession(client)

    await store.sync("child")

    expect(client.requests).toEqual([{ sessionID: "child", limit: 20, before: undefined }])
    expect(client.rootRequests).toEqual([{ sessionID: "child", messageID: user.id }])
    expect(store.data.message.child).toEqual([user, ...assistants])
    expect(store.history.more("child")).toBe(true)
  })

  test("keeps assistant history when its deleted parent cannot be backfilled", async () => {
    const missing = Promise.withResolvers<SingleMessageResponse>()
    const assistant = assistantMessage("message-2", "message-missing")
    const client = rootMessageClient([response([{ info: assistant, parts: [] }], "older")], [missing.promise])
    const store = createServerSession(client)
    const loading = store.sync("child")
    await client.rootRequested(1)

    missing.reject(new Error("Message not found: message-missing", { cause: { status: 404 } }))
    await loading

    expect(client.rootRequests).toEqual([{ sessionID: "child", messageID: "message-missing" }])
    expect(store.data.message.child).toEqual([assistant])
    expect(store.history.more("child")).toBe(true)
  })

  test("drops a cached parent when a forced refresh confirms it was deleted", async () => {
    const missing = Promise.withResolvers<SingleMessageResponse>()
    const parent = userMessage("message-1")
    const part = textPart(parent.id)
    const assistant = assistantMessage("message-2", parent.id)
    const client = rootMessageClient(
      [
        response([
          { info: parent, parts: [part] },
          { info: assistant, parts: [] },
        ]),
        response([{ info: assistant, parts: [] }], "older"),
      ],
      [missing.promise],
    )
    const store = createServerSession(client)
    await store.sync("child")
    const loading = store.sync("child", { force: true })
    await client.rootRequested(1)

    missing.reject(new Error(`Message not found: ${parent.id}`, { cause: { status: 404 } }))
    await loading

    expect(store.data.message.child).toEqual([assistant])
    expect(store.data.part[parent.id]).toBeUndefined()
  })

  test("does not let an optimistic user suppress initial root backfill", async () => {
    const user = userMessage("message-1")
    const part = textPart(user.id)
    const assistants = [assistantMessage("message-2", user.id), assistantMessage("message-3", user.id)]
    const client = rootMessageClient(
      [
        response(
          assistants.map((info) => ({ info, parts: [] })),
          "older",
        ),
      ],
      [singleResponse(user)],
    )
    const store = createServerSession(client)
    store.optimistic.add({ sessionID: "child", message: user, parts: [part] })

    await store.sync("child")
    store.optimistic.remove({ sessionID: "child", messageID: user.id })

    expect(client.requests).toHaveLength(1)
    expect(client.rootRequests).toHaveLength(1)
    expect(store.data.message.child).toEqual([user, ...assistants])
  })

  test("backfills the parent of fetched assistants when another user is cached", async () => {
    const unrelated = userMessage("message-0", { time: { created: 0 } })
    const user = userMessage("message-1")
    const assistants = [assistantMessage("message-2", user.id), assistantMessage("message-3", user.id)]
    const client = rootMessageClient(
      [
        response([{ info: unrelated, parts: [] }]),
        response(
          assistants.map((info) => ({ info, parts: [] })),
          "older",
        ),
      ],
      [singleResponse(user)],
    )
    const store = createServerSession(client)
    await store.sync("child")

    await store.sync("child", { force: true })

    expect(client.requests).toHaveLength(2)
    expect(client.rootRequests).toHaveLength(1)
    expect(store.data.message.child).toEqual([unrelated, user, ...assistants])
  })

  test("preserves cached history between an injected parent and the page boundary", async () => {
    const user = userMessage("message-1")
    const cached = userMessage("message-3", { time: { created: 3 } })
    const assistant = assistantMessage("message-4", user.id)
    const client = rootMessageClient(
      [response([{ info: cached, parts: [] }]), response([{ info: assistant, parts: [] }], "older")],
      [singleResponse(user)],
    )
    const store = createServerSession(client)
    await store.sync("child")

    await store.sync("child", { force: true })

    expect(store.data.message.child).toEqual([user, cached, assistant])
  })

  test("refreshes a cached parent omitted by an assistant-only replacement page", async () => {
    const stale = userMessage("message-1", { summary: { title: "stale", diffs: [] } })
    const fresh = { ...stale, summary: { title: "fresh", diffs: [] } }
    const stalePart = textPart(stale.id, { text: "stale" })
    const freshPart = { ...stalePart, text: "fresh" }
    const assistant = assistantMessage("message-2", stale.id)
    const client = rootMessageClient(
      [response([{ info: stale, parts: [stalePart] }]), response([{ info: assistant, parts: [] }], "older")],
      [singleResponse(fresh, [freshPart])],
    )
    const store = createServerSession(client)
    await store.sync("child")

    await store.sync("child", { force: true })

    expect(client.rootRequests).toEqual([{ sessionID: "child", messageID: stale.id }])
    expect(store.data.message.child).toEqual([fresh, assistant])
    expect(store.data.part[stale.id]).toEqual([freshPart])
  })

  test("refreshes a confirmed optimistic parent while preserving pending parts", async () => {
    const stale = userMessage("message-1", { summary: { title: "stale", diffs: [] } })
    const fresh = { ...stale, summary: { title: "fresh", diffs: [] } }
    const confirmed = textPart(stale.id, { id: "confirmed", text: "stale" })
    const refreshed = { ...confirmed, text: "fresh" }
    const pending = textPart(stale.id, { id: "pending", text: "pending" })
    const assistant = assistantMessage("message-2", stale.id)
    const client = rootMessageClient(
      [response([{ info: stale, parts: [confirmed] }]), response([{ info: assistant, parts: [] }], "older")],
      [singleResponse(fresh, [refreshed])],
    )
    const store = createServerSession(client)
    store.optimistic.add({ sessionID: "child", message: stale, parts: [confirmed, pending] })
    await store.sync("child")

    await store.sync("child", { force: true })

    expect(client.rootRequests).toEqual([{ sessionID: "child", messageID: stale.id }])
    expect(store.data.message.child).toEqual([fresh, assistant])
    expect(store.data.part[stale.id]).toEqual([refreshed, pending])
  })

  test("uses a parent received by SSE during the replacement load", async () => {
    const pending = deferredResponse()
    const user = userMessage("message-1")
    const assistant = assistantMessage("message-2", user.id)
    const client = rootMessageClient([pending.promise], [])
    const store = createServerSession(client)
    const loading = store.sync("child")

    store.apply({ type: "message.updated", properties: { info: user } })
    pending.resolve(response([{ info: assistant, parts: [] }], "older"))
    await loading

    expect(client.rootRequests).toEqual([])
    expect(store.data.message.child).toEqual([user, assistant])
  })

  test("uses a successful retry over events received by a failed backfill attempt", async () => {
    const failed = deferredResponse()
    const user = userMessage("message-1")
    const live = { ...user, agent: "stale" }
    const assistants = [assistantMessage("message-2", user.id), assistantMessage("message-3", user.id)]
    const client = rootMessageClient(
      [
        response(
          assistants.map((info) => ({ info, parts: [] })),
          "older",
        ),
      ],
      [failed.promise.then((result) => ({ data: result.data[0]! })), singleResponse(user)],
    )
    const store = createServerSession(client, { retry: retryImmediately })
    const loading = store.sync("child")
    await client.rootRequested(1)

    store.apply({ type: "message.updated", properties: { info: live } })
    failed.reject(new Error("retry"))
    await loading

    expect(client.requests).toHaveLength(1)
    expect(client.rootRequests).toHaveLength(2)
    expect(store.data.message.child).toEqual([user, ...assistants])
  })

  test("preserves newer-page events across a failed parent retry", async () => {
    const failed = deferredResponse()
    const user = userMessage("message-1")
    const assistant = assistantMessage("message-2", user.id)
    const live = { ...assistant, cost: 1 }
    const client = rootMessageClient(
      [response([{ info: assistant, parts: [] }], "older")],
      [failed.promise.then((result) => ({ data: result.data[0]! })), singleResponse(user)],
    )
    const store = createServerSession(client, { retry: retryImmediately })
    const loading = store.sync("child")
    await client.rootRequested(1)

    store.apply({ type: "message.updated", properties: { info: live } })
    failed.reject(new Error("retry"))
    await loading

    expect(store.data.message.child).toEqual([user, live])
  })

  test("preserves unrelated message events across a failed parent retry", async () => {
    const failed = deferredResponse()
    const user = userMessage("message-1")
    const assistant = assistantMessage("message-2", user.id)
    const live = userMessage("message-4", { time: { created: 4 } })
    const client = rootMessageClient(
      [response([{ info: assistant, parts: [] }], "older")],
      [failed.promise.then((result) => ({ data: result.data[0]! })), singleResponse(user)],
    )
    const store = createServerSession(client, { retry: retryImmediately })
    const loading = store.sync("child")
    await client.rootRequested(1)

    store.apply({ type: "message.updated", properties: { info: live } })
    failed.reject(new Error("retry"))
    await loading

    expect(store.data.message.child).toEqual([user, assistant, live])
  })

  test("preserves newer-page part events across a failed parent retry", async () => {
    const failed = deferredResponse()
    const user = userMessage("message-1")
    const assistant = assistantMessage("message-2", user.id)
    const stale = textPart(assistant.id, { text: "stale" })
    const live = { ...stale, text: "live" }
    const client = rootMessageClient(
      [response([{ info: assistant, parts: [stale] }], "older")],
      [failed.promise.then((result) => ({ data: result.data[0]! })), singleResponse(user)],
    )
    const store = createServerSession(client, { retry: retryImmediately })
    const loading = store.sync("child")
    await client.rootRequested(1)

    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part: live, time: 2 } })
    failed.reject(new Error("retry"))
    await loading

    expect(store.data.part[assistant.id]).toEqual([live])
  })

  test("merges live events into the initial page", async () => {
    const pending = deferredResponse()
    const user = userMessage("message-1")
    const live = userMessage("message-2", { time: { created: 2 } })
    const livePart = textPart(live.id, { text: "live" })
    const store = createServerSession(messageClient(pending.promise))
    const loading = store.sync("child")

    store.apply({ type: "message.updated", properties: { info: live } })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part: livePart, time: 2 } })
    pending.resolve(response([{ info: user, parts: [] }]))
    await loading

    expect(store.data.message.child).toEqual([user, live])
    expect(store.data.part[live.id]).toEqual([livePart])
  })

  test("preserves same-ID live updates over the initial page", async () => {
    const pending = deferredResponse()
    const fetched = userMessage("message")
    const fetchedPart = textPart(fetched.id, { text: "fetched" })
    const live = { ...fetched, time: { created: 2 } }
    const livePart = { ...fetchedPart, text: "live" }
    const store = createServerSession(messageClient(pending.promise))
    const loading = store.sync("child")

    store.apply({ type: "message.updated", properties: { info: live } })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part: livePart, time: 2 } })
    pending.resolve(response([{ info: fetched, parts: [fetchedPart] }]))
    await loading

    expect(store.data.message.child).toEqual([live])
    expect(store.data.part[live.id]).toEqual([livePart])
  })

  test("preserves removals received during the initial load", async () => {
    const pending = deferredResponse()
    const removed = userMessage("message-1")
    const kept = { ...removed, id: "message-2" }
    const part = textPart(kept.id, { text: "removed" })
    const store = createServerSession(messageClient(pending.promise))
    const loading = store.sync("child")

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: removed.id } })
    store.apply({
      type: "message.part.removed",
      properties: { sessionID: "child", messageID: kept.id, partID: part.id },
    })
    pending.resolve(
      response([
        { info: removed, parts: [] },
        { info: kept, parts: [part] },
      ]),
    )
    await loading

    expect(store.data.message.child).toEqual([kept])
    expect(store.data.part[kept.id]).toBeUndefined()
  })

  test("keeps removal tracking isolated across load generations", async () => {
    const firstResponse = deferredResponse()
    const secondResponse = deferredResponse()
    const message = userMessage("message")
    const store = createServerSession(messageClient(firstResponse.promise, secondResponse.promise))
    const first = store.sync("child")

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })
    store.apply({
      type: "session.deleted",
      properties: { sessionID: "child", info: session("child", "root") },
    })
    const second = store.sync("child")

    firstResponse.resolve(response())
    await first
    secondResponse.resolve(response([{ info: message, parts: [] }]))
    await second

    expect(store.data.message.child).toEqual([message])
  })

  test("tracks removals in a replacement load generation", async () => {
    const firstResponse = deferredResponse()
    const secondResponse = deferredResponse()
    const message = userMessage("message")
    const store = createServerSession(messageClient(firstResponse.promise, secondResponse.promise))
    const first = store.sync("child")
    store.apply({
      type: "session.deleted",
      properties: { sessionID: "child", info: session("child", "root") },
    })
    const second = store.sync("child")

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })
    firstResponse.resolve(response())
    await first
    secondResponse.resolve(response([{ info: message, parts: [] }]))
    await second

    expect(store.data.message.child).toEqual([])
  })

  test("preserves remove then re-add when a refresh omits the message", async () => {
    const pending = deferredResponse()
    const message = userMessage("message")
    const store = createServerSession(messageClient(response([{ info: message, parts: [] }]), pending.promise))
    await store.sync("child")
    const refreshing = store.sync("child", { force: true })

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })
    store.apply({ type: "message.updated", properties: { info: message } })
    pending.resolve(response())
    await refreshing

    expect(store.data.message.child).toEqual([message])
  })

  test("preserves a re-added message without restoring removed parts", async () => {
    const pending = deferredResponse()
    const message = userMessage("message")
    const part = textPart(message.id, { text: "stale" })
    const store = createServerSession(messageClient(response([{ info: message, parts: [] }]), pending.promise))
    await store.sync("child")
    const refreshing = store.sync("child", { force: true })

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })
    store.apply({ type: "message.updated", properties: { info: message } })
    pending.resolve(response([{ info: message, parts: [part] }]))
    await refreshing

    expect(store.data.message.child).toEqual([message])
    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("preserves optimistic parts re-added after removal during a refresh", async () => {
    const pending = deferredResponse()
    const message = userMessage("message")
    const stale = textPart(message.id, { id: "stale", text: "stale" })
    const part = textPart(message.id, { id: "optimistic", text: "optimistic" })
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [] }]), pending.promise, response()),
    )
    await store.sync("child")
    const refreshing = store.sync("child", { force: true })

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })
    store.optimistic.add({ sessionID: "child", message, parts: [part] })
    pending.resolve(response([{ info: message, parts: [stale] }]))
    await refreshing

    expect(store.data.message.child).toEqual([message])
    expect(store.data.part[message.id]).toEqual([part])

    await store.sync("child", { force: true })
    expect(store.data.message.child).toEqual([message])
    expect(store.data.part[message.id]).toEqual([part])
  })

  test("drops stale event content omitted by a complete initial page", async () => {
    const stale = userMessage("stale")
    const store = createServerSession(messageClient(response()))
    store.apply({ type: "message.updated", properties: { info: stale } })

    await store.sync("child")

    expect(store.data.message.child).toEqual([])
  })

  test("preserves event content outside an incomplete initial page", async () => {
    const live = userMessage("message-1")
    const fetched = userMessage("message-2", { time: { created: 2 } })
    const store = createServerSession(messageClient(response([{ info: fetched, parts: [] }], "older")))
    store.apply({ type: "message.updated", properties: { info: live } })

    await store.sync("child")

    expect(store.data.message.child).toEqual([live, fetched])
  })

  test("does not restore removed optimistic content on refresh", async () => {
    const message = userMessage("message")
    const part = textPart(message.id, { text: "removed" })
    const kept = { ...message, id: "kept" }
    const keptPart = { ...part, id: "kept-part", messageID: kept.id }
    const store = createServerSession(messageClient(response([{ info: kept, parts: [] }])))
    store.optimistic.add({ sessionID: "child", message, parts: [part] })
    store.optimistic.add({ sessionID: "child", message: kept, parts: [keptPart] })

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })
    store.apply({
      type: "message.part.removed",
      properties: { sessionID: "child", messageID: kept.id, partID: keptPart.id },
    })
    await store.sync("child", { force: true })

    expect(store.data.message.child).toEqual([kept])
    expect(store.data.part[message.id]).toBeUndefined()
    expect(store.data.part[kept.id]).toBeUndefined()
  })

  test("replaces confirmed optimistic content with the initial page", async () => {
    const optimistic = userMessage("message")
    const fetched = { ...optimistic, time: { created: 2 } }
    const store = createServerSession(messageClient(response([{ info: fetched, parts: [] }])))
    store.optimistic.add({ sessionID: "child", message: optimistic, parts: [] })

    await store.sync("child")

    expect(store.data.message.child).toEqual([fetched])
  })

  test("replaces a confirmed optimistic part with fetched content", async () => {
    const pending = deferredResponse()
    const message = userMessage("message")
    const optimistic = textPart(message.id, { text: "optimistic" })
    const fetched = { ...optimistic, text: "fetched" }
    const store = createServerSession(messageClient(pending.promise))
    const loading = store.sync("child")

    store.optimistic.add({ sessionID: "child", message, parts: [optimistic] })
    pending.resolve(response([{ info: message, parts: [fetched] }]))
    await loading

    expect(store.data.part[message.id]).toEqual([fetched])
  })

  test("rolls back only unconfirmed optimistic parts", async () => {
    const pending = deferredResponse()
    const message = userMessage("message")
    const confirmed = textPart(message.id, { id: "confirmed", text: "confirmed" })
    const pendingPart = textPart(message.id, { id: "pending", text: "pending" })
    const store = createServerSession(messageClient(pending.promise))
    const loading = store.sync("child")
    store.optimistic.add({ sessionID: "child", message, parts: [confirmed, pendingPart] })

    pending.resolve(response([{ info: message, parts: [confirmed] }]))
    await loading
    store.optimistic.remove({ sessionID: "child", messageID: message.id })

    expect(store.data.message.child).toEqual([message])
    expect(store.data.part[message.id]).toEqual([confirmed])
  })

  test("updates confirmed optimistic parts from later pages", async () => {
    const message = userMessage("message")
    const confirmed = textPart(message.id, { id: "confirmed", text: "first" })
    const updated = { ...confirmed, text: "updated" }
    const pendingPart = textPart(message.id, { id: "pending", text: "pending" })
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [confirmed] }]), response([{ info: message, parts: [updated] }])),
    )
    store.optimistic.add({ sessionID: "child", message, parts: [confirmed, pendingPart] })
    await store.sync("child")

    await store.sync("child", { force: true })
    store.optimistic.remove({ sessionID: "child", messageID: message.id })

    expect(store.data.part[message.id]).toEqual([updated])
  })

  test("does not restore a confirmed optimistic part after its removal event", async () => {
    const message = userMessage("message")
    const confirmed = textPart(message.id, { id: "confirmed", text: "confirmed" })
    const pendingPart = textPart(message.id, { id: "pending", text: "pending" })
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [confirmed] }]), response([{ info: message, parts: [] }])),
    )
    store.optimistic.add({ sessionID: "child", message, parts: [confirmed, pendingPart] })
    await store.sync("child")
    store.apply({
      type: "message.part.removed",
      properties: { sessionID: "child", messageID: message.id, partID: confirmed.id },
    })

    await store.sync("child", { force: true })

    expect(store.data.part[message.id]).toEqual([pendingPart])
  })

  test("clears delta buffers when removing optimistic content", () => {
    const message = userMessage("message")
    const part = textPart(message.id, { text: "optimistic" })
    const store = setup({ child: session("child") }).store
    store.optimistic.add({ sessionID: "child", message, parts: [part] })
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: part.id, field: "text", delta: " delta" },
    })

    store.optimistic.remove({ sessionID: "child", messageID: message.id })

    expect(store.data.part[message.id]).toBeUndefined()
    expect(store.data.part_text_accum_delta[part.id]).toBeUndefined()
  })

  test("does not remove content confirmed by a message event", () => {
    const message = userMessage("message")
    const part = textPart(message.id)
    const store = setup({ child: session("child") }).store
    store.optimistic.add({ sessionID: "child", message, parts: [part] })
    store.apply({ type: "message.updated", properties: { sessionID: "child", info: message } })

    store.optimistic.remove({ sessionID: "child", messageID: message.id })

    expect(store.data.message.child).toEqual([message])
    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("does not remove parts confirmed by part events", () => {
    const message = userMessage("message")
    const part = textPart(message.id)
    const store = setup({ child: session("child") }).store
    store.optimistic.add({ sessionID: "child", message, parts: [part] })
    store.apply({ type: "message.updated", properties: { sessionID: "child", info: message } })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part, time: 2 } })

    store.optimistic.remove({ sessionID: "child", messageID: message.id })

    expect(store.data.message.child).toEqual([message])
    expect(store.data.part[message.id]).toEqual([part])
  })

  test("treats a part event as confirmation when it precedes the message event", () => {
    const message = userMessage("message")
    const part = textPart(message.id)
    const store = setup({ child: session("child") }).store
    store.optimistic.add({ sessionID: "child", message, parts: [part] })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part, time: 2 } })

    store.optimistic.remove({ sessionID: "child", messageID: message.id })

    expect(store.data.message.child).toEqual([message])
    expect(store.data.part[message.id]).toEqual([part])
  })

  test("clears stale parts when the initial page has none", async () => {
    const pending = deferredResponse()
    const message = userMessage("message")
    const part = textPart(message.id, { text: "stale" })
    const store = createServerSession(messageClient(pending.promise))
    store.apply({ type: "message.updated", properties: { info: message } })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part, time: 1 } })
    const loading = store.sync("child")

    pending.resolve(response([{ info: message, parts: [] }]))
    await loading

    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("clears delta buffers for parts omitted by the initial page", async () => {
    const pending = deferredResponse()
    const message = userMessage("message")
    const kept = textPart(message.id, { id: "part-1", text: "kept" })
    const removed: Part = { ...kept, id: "part-2", text: "removed" }
    const store = createServerSession(messageClient(pending.promise))
    store.apply({ type: "message.updated", properties: { info: message } })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part: kept, time: 1 } })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part: removed, time: 1 } })
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: removed.id, field: "text", delta: " delta" },
    })
    const loading = store.sync("child")

    pending.resolve(response([{ info: message, parts: [kept] }]))
    await loading

    expect(store.data.part[message.id]).toEqual([kept])
    expect(store.data.part_text_accum_delta[removed.id]).toBeUndefined()
  })

  test("clears a stale delta buffer when a refresh replaces its part", async () => {
    const message = userMessage("message")
    const stale = textPart(message.id, { text: "stale" })
    const fetched = { ...stale, text: "fetched" }
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [stale] }]), response([{ info: message, parts: [fetched] }])),
    )
    await store.sync("child")
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: stale.id, field: "text", delta: " delta" },
    })

    await store.sync("child", { force: true })

    expect(store.data.part[message.id]).toEqual([fetched])
    expect(store.data.part_text_accum_delta[stale.id]).toBeUndefined()
  })

  test("preserves a non-durable delta received before refresh", async () => {
    const message = userMessage("message")
    const part = textPart(message.id, { text: "stale" })
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [part] }]), response([{ info: message, parts: [{ ...part }] }])),
    )
    await store.sync("child")
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: part.id, field: "text", delta: " delta" },
    })

    await store.sync("child", { force: true })

    expect(store.data.part[message.id]).toEqual([{ ...part, text: "stale delta" }])
    expect(store.data.part_text_accum_delta[part.id]).toBe("stale delta")
  })

  test("accepts fetched text that intentionally replaces an accumulated prefix", async () => {
    const message = userMessage("message")
    const part = textPart(message.id, { text: "abc" })
    const fetched = { ...part, text: "ab" }
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [part] }]), response([{ info: message, parts: [fetched] }])),
    )
    await store.sync("child")
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: part.id, field: "text", delta: "def" },
    })

    await store.sync("child", { force: true })

    expect(store.data.part[message.id]).toEqual([fetched])
    expect(store.data.part_text_accum_delta[part.id]).toBeUndefined()
  })

  test("preserves an unpersisted delta suffix after partial server catch-up", async () => {
    const message = userMessage("message")
    const part = textPart(message.id, { text: "a" })
    const fetched = { ...part, text: "ab" }
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [part] }]), response([{ info: message, parts: [fetched] }])),
    )
    await store.sync("child")
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: part.id, field: "text", delta: "bc" },
    })

    await store.sync("child", { force: true })

    expect(store.data.part[message.id]).toEqual([{ ...part, text: "abc" }])
    expect(store.data.part_text_accum_delta[part.id]).toBe("abc")
  })

  test("clears delta state after exact server catch-up", async () => {
    const message = userMessage("message")
    const part = textPart(message.id, { text: "a" })
    const fetched = { ...part, text: "ab" }
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [part] }]), response([{ info: message, parts: [fetched] }])),
    )
    await store.sync("child")
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: part.id, field: "text", delta: "b" },
    })

    await store.sync("child", { force: true })

    expect(store.data.part[message.id]).toEqual([fetched])
    expect(store.data.part_text_accum_delta[part.id]).toBeUndefined()
  })

  test("uses the successful retry response over events from a failed attempt", async () => {
    const failed = Promise.withResolvers<MessageResponse>()
    const retried = Promise.withResolvers<MessageResponse>()
    const message = userMessage("message")
    const stale = textPart(message.id, { text: "stale" })
    const intermediate = { ...stale, text: "intermediate" }
    const fetched = { ...stale, text: "fetched" }
    const client = messageClient(failed.promise, retried.promise)
    const store = createServerSession(client, { retry: retryImmediately })
    store.apply({ type: "message.updated", properties: { info: message } })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part: stale, time: 1 } })
    const loading = store.sync("child")

    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part: intermediate, time: 2 } })
    failed.reject(new Error("failed to fetch"))
    await client.requested(2)
    retried.resolve(response([{ info: message, parts: [fetched] }]))
    await loading

    expect(store.data.part[message.id]).toEqual([fetched])
  })

  test("preserves non-durable deltas across message retries", async () => {
    const failed = Promise.withResolvers<MessageResponse>()
    const retried = Promise.withResolvers<MessageResponse>()
    const message = userMessage("message")
    const part = textPart(message.id, { text: "stale" })
    const client = messageClient(failed.promise, retried.promise)
    const store = createServerSession(client, { retry: retryImmediately })
    store.apply({ type: "message.updated", properties: { info: message } })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part, time: 1 } })
    const loading = store.sync("child")

    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: part.id, field: "text", delta: " delta" },
    })
    failed.reject(new Error("failed to fetch"))
    await client.requested(2)
    retried.resolve(response([{ info: message, parts: [part] }]))
    await loading

    expect(store.data.part[message.id]).toEqual([{ ...part, text: "stale delta" }])
  })

  test("preserves part removals across message retries", async () => {
    const failed = Promise.withResolvers<MessageResponse>()
    const retried = Promise.withResolvers<MessageResponse>()
    const message = userMessage("message")
    const part = textPart(message.id)
    const client = messageClient(response([{ info: message, parts: [part] }]), failed.promise, retried.promise)
    const store = createServerSession(client, { retry: retryImmediately })
    await store.sync("child")
    const loading = store.sync("child", { force: true })

    store.apply({
      type: "message.part.removed",
      properties: { sessionID: "child", messageID: message.id, partID: part.id },
    })
    failed.reject(new Error("failed to fetch"))
    await client.requested(3)
    retried.resolve(response([{ info: message, parts: [part] }]))
    await loading

    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("preserves message removals across message retries", async () => {
    const failed = Promise.withResolvers<MessageResponse>()
    const retried = Promise.withResolvers<MessageResponse>()
    const message = userMessage("message")
    const part = textPart(message.id)
    const client = messageClient(response([{ info: message, parts: [part] }]), failed.promise, retried.promise)
    const store = createServerSession(client, { retry: retryImmediately })
    await store.sync("child")
    const loading = store.sync("child", { force: true })

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })
    failed.reject(new Error("failed to fetch"))
    await client.requested(3)
    retried.resolve(response([{ info: message, parts: [part] }]))
    await loading

    expect(store.data.message.child).toEqual([])
    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("preserves optimistic re-adds across message retries", async () => {
    const failed = Promise.withResolvers<MessageResponse>()
    const retried = Promise.withResolvers<MessageResponse>()
    const message = userMessage("message")
    const stale = textPart(message.id, { id: "stale", text: "stale" })
    const optimistic = textPart(message.id, { id: "optimistic", text: "optimistic" })
    const client = messageClient(response([{ info: message, parts: [stale] }]), failed.promise, retried.promise)
    const store = createServerSession(client, { retry: retryImmediately })
    await store.sync("child")
    const loading = store.sync("child", { force: true })

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })
    store.optimistic.add({ sessionID: "child", message, parts: [optimistic] })
    failed.reject(new Error("failed to fetch"))
    await client.requested(3)
    retried.resolve(response([{ info: message, parts: [stale] }]))
    await loading

    expect(store.data.message.child).toEqual([message])
    expect(store.data.part[message.id]).toEqual([optimistic])
  })

  test("accepts part omission from a successful retry after an earlier delta", async () => {
    const failed = Promise.withResolvers<MessageResponse>()
    const retried = Promise.withResolvers<MessageResponse>()
    const message = userMessage("message")
    const part = textPart(message.id)
    const client = messageClient(response([{ info: message, parts: [part] }]), failed.promise, retried.promise)
    const store = createServerSession(client, { retry: retryImmediately })
    await store.sync("child")
    const loading = store.sync("child", { force: true })

    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: part.id, field: "text", delta: " delta" },
    })
    failed.reject(new Error("failed to fetch"))
    await client.requested(3)
    retried.resolve(response([{ info: message, parts: [] }]))
    await loading

    expect(store.data.part[message.id]).toBeUndefined()
    expect(store.data.part_text_accum_delta[part.id]).toBeUndefined()
  })

  test("clears load-owned orphan parts when all retries fail", async () => {
    const first = Promise.withResolvers<MessageResponse>()
    const second = Promise.withResolvers<MessageResponse>()
    const third = Promise.withResolvers<MessageResponse>()
    const message = userMessage("message")
    const part = textPart(message.id)
    const client = messageClient(first.promise, second.promise, third.promise)
    const store = createServerSession(client, { retry: retryImmediately })
    const loading = store.sync("child").catch((error) => error)

    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part, time: 2 } })
    first.reject(new Error("failed to fetch"))
    await client.requested(2)
    second.reject(new Error("failed to fetch"))
    await client.requested(3)
    third.reject(new Error("failed to fetch"))
    await loading

    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("preserves live updates during a forced refresh", async () => {
    const pending = deferredResponse()
    const stale = userMessage("message")
    const stalePart = textPart(stale.id, { text: "stale" })
    const store = createServerSession(messageClient(response([{ info: stale, parts: [stalePart] }]), pending.promise))
    await store.sync("child")
    const refreshing = store.sync("child", { force: true })
    const live = { ...stale, time: { created: 2 } }

    store.apply({ type: "message.updated", properties: { info: live } })
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: stale.id, partID: stalePart.id, field: "text", delta: " live" },
    })
    pending.resolve(response([{ info: stale, parts: [stalePart] }]))
    await refreshing

    expect(store.data.message.child).toEqual([live])
    expect(store.data.part[stale.id]).toEqual([{ ...stalePart, text: "stale live" }])
  })

  test("keeps fetched message metadata when only a part changes", async () => {
    const pending = deferredResponse()
    const stale = userMessage("message")
    const fetched = { ...stale, time: { created: 2 } }
    const part = textPart(stale.id, { text: "stale" })
    const store = createServerSession(messageClient(response([{ info: stale, parts: [part] }]), pending.promise))
    await store.sync("child")
    const refreshing = store.sync("child", { force: true })

    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: stale.id, partID: part.id, field: "text", delta: " live" },
    })
    pending.resolve(response([{ info: fetched, parts: [part] }]))
    await refreshing

    expect(store.data.message.child).toEqual([fetched])
    expect(store.data.part[stale.id]).toEqual([{ ...part, text: "stale live" }])
  })

  test("preserves a part update when a forced refresh omits its message", async () => {
    const pending = deferredResponse()
    const message = userMessage("message")
    const stale = textPart(message.id, { text: "stale" })
    const live = { ...stale, text: "live" }
    const store = createServerSession(messageClient(response([{ info: message, parts: [stale] }]), pending.promise))
    await store.sync("child")
    const refreshing = store.sync("child", { force: true })

    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part: live, time: 2 } })
    pending.resolve(response())
    await refreshing

    expect(store.data.message.child).toEqual([message])
    expect(store.data.part[message.id]).toEqual([live])
  })

  test("ignores a late part update after its message is removed", async () => {
    const pending = deferredResponse()
    const message = userMessage("message")
    const part = textPart(message.id)
    const store = createServerSession(messageClient(pending.promise))
    const loading = store.sync("child")

    store.apply({ type: "message.updated", properties: { info: message } })
    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part, time: 2 } })
    pending.resolve(response([{ info: message, parts: [part] }]))
    await loading

    expect(store.data.message.child).toEqual([])
    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("ignores a late part update after a completed message removal", () => {
    const message = userMessage("message")
    const part = textPart(message.id)
    const store = setup({ child: session("child") }).store
    store.apply({ type: "message.updated", properties: { info: message } })
    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })

    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part, time: 2 } })

    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("does not restore a completed message removal from a stale refresh", async () => {
    const message = userMessage("message")
    const part = textPart(message.id)
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [part] }]), response([{ info: message, parts: [part] }])),
    )
    await store.sync("child")
    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })

    await store.sync("child", { force: true })

    expect(store.data.message.child).toEqual([])
    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("does not restore a completed part removal from a stale refresh", async () => {
    const message = userMessage("message")
    const part = textPart(message.id)
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [part] }]), response([{ info: message, parts: [part] }])),
    )
    await store.sync("child")
    store.apply({
      type: "message.part.removed",
      properties: { sessionID: "child", messageID: message.id, partID: part.id },
    })

    await store.sync("child", { force: true })

    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("does not cache skipped optimistic parts", () => {
    const message = userMessage("message")
    const part = { id: "part", sessionID: "child", messageID: message.id, type: "step-start" as const }
    const store = setup({ child: session("child") }).store

    store.optimistic.add({ sessionID: "child", message, parts: [part] })

    expect(store.data.part[message.id]).toEqual([])
  })

  test("clears stale delta buffers when replacing optimistic parts", () => {
    const message = userMessage("message")
    const stale = textPart(message.id, { id: "stale", text: "stale" })
    const optimistic = textPart(message.id, { id: "optimistic", text: "optimistic" })
    const store = setup({ child: session("child") }).store
    store.optimistic.add({ sessionID: "child", message, parts: [stale] })
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: stale.id, field: "text", delta: " delta" },
    })

    store.optimistic.add({ sessionID: "child", message, parts: [optimistic] })

    expect(store.data.part_text_accum_delta[stale.id]).toBeUndefined()
    expect(store.data.part_text_accum_delta[optimistic.id]).toBeUndefined()
  })

  test("preserves removals during history prepend", async () => {
    const pending = deferredResponse()
    const latest = userMessage("message-2", { time: { created: 2 } })
    const older = { ...latest, id: "message-1", time: { created: 1 } }
    const store = createServerSession(messageClient(response([{ info: latest, parts: [] }], "older"), pending.promise))
    await store.sync("child")
    const loading = store.history.loadMore("child")

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: older.id } })
    pending.resolve(response([{ info: older, parts: [] }]))
    await loading

    expect(store.data.message.child).toEqual([latest])
  })

  test("does not scan cached messages for user roots during history prepend", async () => {
    const guard = { active: false }
    const latest = new Proxy(userMessage("message-2", { time: { created: 2 } }), {
      get(target, property, receiver) {
        if (guard.active && property === "role") throw new Error("cached role accessed")
        return Reflect.get(target, property, receiver)
      },
    })
    const older = userMessage("message-1")
    const store = createServerSession(
      messageClient(response([{ info: latest, parts: [] }], "older"), response([{ info: older, parts: [] }])),
    )
    await store.sync("child")
    guard.active = true

    await store.history.loadMore("child")

    expect(store.data.message.child).toEqual([older, latest])
  })

  test("preserves loaded history during an incomplete refresh", async () => {
    const older = userMessage("message-1")
    const latest = userMessage("message-2", { time: { created: 2 } })
    const fresh = userMessage("message-3", { time: { created: 3 } })
    const store = createServerSession(
      messageClient(
        response(
          [
            { info: older, parts: [] },
            { info: latest, parts: [] },
          ],
          "older",
        ),
        response(
          [
            { info: latest, parts: [] },
            { info: fresh, parts: [] },
          ],
          "older",
        ),
      ),
    )
    await store.sync("child")

    await store.sync("child", { force: true })

    expect(store.data.message.child).toEqual([older, latest, fresh])
  })

  test("drops stale recent messages omitted by an incomplete refresh", async () => {
    const third = userMessage("message-3", { time: { created: 3 } })
    const fourth = userMessage("message-4", { time: { created: 4 } })
    const stale = userMessage("message-5", { time: { created: 5 } })
    const store = createServerSession(
      messageClient(
        response(
          [
            { info: fourth, parts: [] },
            { info: stale, parts: [] },
          ],
          "older",
        ),
        response(
          [
            { info: third, parts: [] },
            { info: fourth, parts: [] },
          ],
          "older",
        ),
      ),
    )
    await store.sync("child")

    await store.sync("child", { force: true })

    expect(store.data.message.child).toEqual([third, fourth])
  })

  test("uses message creation time for incomplete refresh boundaries", async () => {
    const older = userMessage("msg_z", { time: { created: 1 } })
    const boundary = userMessage("msg_m", { time: { created: 2 } })
    const stale = userMessage("msg_a", { time: { created: 3 } })
    const store = createServerSession(
      messageClient(
        response(
          [
            { info: older, parts: [] },
            { info: stale, parts: [] },
          ],
          "older",
        ),
        response([{ info: boundary, parts: [] }], "older"),
      ),
    )
    await store.sync("child")

    await store.sync("child", { force: true })

    expect(store.data.message.child).toEqual([boundary, older])
  })

  test("preserves a part update for a message being loaded from history", async () => {
    const pending = deferredResponse()
    const latest = userMessage("message-2", { time: { created: 2 } })
    const older = userMessage("message-1")
    const stale = textPart(older.id, { text: "stale" })
    const live = { ...stale, text: "live" }
    const store = createServerSession(messageClient(response([{ info: latest, parts: [] }], "older"), pending.promise))
    await store.sync("child")
    const loading = store.history.loadMore("child")

    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part: live, time: 2 } })
    pending.resolve(response([{ info: older, parts: [stale] }]))
    await loading

    expect(store.data.part[older.id]).toEqual([live])
  })

  test("does not clear newer orphan parts after terminal history prepend", async () => {
    const pending = deferredResponse()
    const latest = userMessage("message-2", { time: { created: 2 } })
    const older = userMessage("message-1")
    const newer = userMessage("message-3", { time: { created: 3 } })
    const part = textPart(newer.id, { text: "live" })
    const store = createServerSession(messageClient(response([{ info: latest, parts: [] }], "older"), pending.promise))
    await store.sync("child")
    const loading = store.history.loadMore("child")

    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part, time: 3 } })
    pending.resolve(response([{ info: older, parts: [] }]))
    await loading
    store.apply({ type: "message.updated", properties: { sessionID: "child", info: newer } })

    expect(store.data.part[newer.id]).toEqual([part])
  })

  test("accepts an authoritative history part after an earlier unknown-parent update", async () => {
    const pending = deferredResponse()
    const history = deferredResponse()
    const latest = userMessage("message-2", { time: { created: 2 } })
    const older = userMessage("message-1")
    const part = textPart(older.id, { text: "live" })
    const store = createServerSession(messageClient(pending.promise, history.promise))
    const loading = store.sync("child")

    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part, time: 2 } })
    pending.resolve(response([{ info: latest, parts: [] }], "older"))
    await loading

    expect(store.data.part[older.id]).toEqual([part])

    const loadingHistory = store.history.loadMore("child")
    history.resolve(response([{ info: older, parts: [{ ...part, text: "stale" }] }]))
    await loadingHistory

    expect(store.data.part[older.id]).toEqual([{ ...part, text: "stale" }])
  })

  test("preserves an unknown-parent part removal across pages", async () => {
    const initial = deferredResponse()
    const history = deferredResponse()
    const latest = userMessage("message-2", { time: { created: 2 } })
    const older = userMessage("message-1")
    const part = textPart(older.id)
    const store = createServerSession(messageClient(initial.promise, history.promise))
    const loading = store.sync("child")

    store.apply({
      type: "message.part.removed",
      properties: { sessionID: "child", messageID: older.id, partID: part.id },
    })
    initial.resolve(response([{ info: latest, parts: [] }], "older"))
    await loading
    const loadingHistory = store.history.loadMore("child")
    history.resolve(response([{ info: older, parts: [part] }]))
    await loadingHistory

    expect(store.data.part[older.id]).toBeUndefined()
  })

  test("clears orphaned parts when a refresh drops a message", async () => {
    const message = userMessage("message")
    const part = textPart(message.id, { text: "stale" })
    const store = createServerSession(messageClient(response([{ info: message, parts: [part] }]), response()))
    await store.sync("child")
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: part.id, field: "text", delta: " delta" },
    })
    await store.sync("child", { force: true })

    expect(store.data.message.child).toEqual([])
    expect(store.data.part[message.id]).toBeUndefined()
    expect(store.data.part_text_accum_delta[part.id]).toBeUndefined()
  })

  test("applies events without a directory store", () => {
    const ctx = setup({})
    ctx.store.apply({ type: "session.created", properties: { sessionID: "root", info: session("root") } })
    ctx.store.apply({ type: "session.status", properties: { sessionID: "root", status: { type: "busy" } } })

    expect(ctx.store.get("root")?.directory).toBe("/repo")
    expect(ctx.store.data.session_working("root")).toBe(true)
    expect(ctx.get).toEqual([])
  })

  test("preserves pinned session content under server-wide cache pressure", () => {
    const ctx = setup({})
    ctx.store.pin("active")
    ctx.store.optimistic.add({
      sessionID: "active",
      message: {
        id: "message",
        sessionID: "active",
        role: "assistant",
        time: { created: 1 },
        parentID: "parent",
        modelID: "model",
        providerID: "provider",
        mode: "build",
        agent: "agent",
        path: { cwd: "/repo", root: "/repo" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      parts: [],
    })

    for (let index = 0; index < 50; index++) {
      ctx.store.remember(session(`session-${index}`))
      ctx.store.apply({
        type: "session.status",
        properties: { sessionID: `session-${index}`, status: { type: "idle" } },
      })
    }

    expect(ctx.store.data.message.active?.map((message) => message.id)).toEqual(["message"])
    expect(ctx.store.data.session_status["session-0"]).toBeUndefined()
  })
})
