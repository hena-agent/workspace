import { PermissionV1 } from "@hena/core/v1/permission"
import { afterEach, describe, expect } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { SessionV1 } from "@hena/core/v1/session"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Cause, Config, Effect, Exit, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { AppNodeBuilder } from "@hena/core/effect/app-node-builder"
import { LayerNode } from "@hena/core/effect/layer-node"
import { CrossSpawnSpawner } from "@hena/core/cross-spawn-spawner"
import { Flag } from "@hena/core/flag/flag"
import { Ripgrep } from "@hena/core/ripgrep"
import { registerAdapter } from "../../src/control-plane/adapters"
import type { WorkspaceAdapter } from "../../src/control-plane/types"
import { Workspace } from "../../src/control-plane/workspace"

import { InstanceBootstrap as InstanceBootstrapService } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { Project } from "../../src/project/project"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import * as HttpSessionError from "../../src/server/routes/instance/httpapi/handlers/session-errors"
import { ExperimentalPaths } from "../../src/server/routes/instance/httpapi/groups/experimental"
import { SessionPaths } from "../../src/server/routes/instance/httpapi/groups/session"
import { Session } from "@/session/session"
import { MessageID, PartID, SessionID, type SessionID as SessionIDType } from "../../src/session/schema"
import { Database } from "@hena/core/database/database"
import { SessionInputTable, SessionMessageTable, SessionTable } from "@hena/core/session/sql"
import { EventTable } from "@hena/core/event/sql"
import { SessionMessage } from "@hena/core/session/message"
import { ModelV2 } from "@hena/core/model"
import { ProviderV2 } from "@hena/core/provider"
import * as DateTime from "effect/DateTime"
import { and, eq } from "drizzle-orm"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, provideInstanceEffect, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { TestLLMServer } from "../lib/llm-server"
import { testProviderConfig } from "../lib/test-provider"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { EventV2Bridge } from "@/event-v2-bridge"
import { createHenaClient } from "@hena/sdk/v2/client"
import { interruptSession, pendingQuestions, respondToQuestion } from "../../../app/src/context/session-runtime"

const originalWorkspaces = Flag.HENA_EXPERIMENTAL_WORKSPACES
const noopBootstrapLayer = Layer.succeed(
  InstanceBootstrapService.Service,
  InstanceBootstrapService.Service.of({ run: Effect.void }),
)
const appLayer = AppNodeBuilder.build(
  LayerNode.group([InstanceStore.node, Project.node, Session.node, Workspace.node, Database.node, Ripgrep.node, EventV2Bridge.node]),
  [[InstanceStore.bootstrapNode, noopBootstrapLayer]],
)
const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.routes,
  {
    disableListenLog: true,
    disableLogger: true,
  },
)
const httpApiLayer = servedRoutes.pipe(
  Layer.provide(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)
const it = testEffect(Layer.mergeAll(appLayer, httpApiLayer))

function pathFor(path: string, params: Record<string, string>) {
  return Object.entries(params).reduce((result, [key, value]) => result.replace(`:${key}`, value), path)
}

function createSession(input?: Session.CreateInput) {
  return Session.use.create(input)
}

function createTextMessage(sessionID: SessionIDType, text: string) {
  return Effect.gen(function* () {
    const svc = yield* Session.Service
    const info = yield* svc.updateMessage({
      id: MessageID.ascending(),
      role: "user",
      sessionID,
      agent: "build",
      model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
      time: { created: Date.now() },
    })
    const part = yield* svc.updatePart({
      id: PartID.ascending(),
      sessionID,
      messageID: info.id,
      type: "text",
      text,
    })
    return { info, part }
  })
}

const localAdapter = (directory: string): WorkspaceAdapter => ({
  name: "Local Test",
  description: "Create a local test workspace",
  configure: (info) => ({ ...info, name: "local-test", directory }),
  create: async () => {
    await mkdir(directory, { recursive: true })
  },
  async remove() {},
  target: () => ({ type: "local" as const, directory }),
})

const createLocalWorkspace = (input: { projectID: Project.Info["id"]; type: string; directory: string }) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      registerAdapter(input.projectID, input.type, localAdapter(input.directory))
      return yield* Workspace.Service.use((svc) =>
        svc.create({
          type: input.type,
          branch: null,
          extra: null,
          projectID: input.projectID,
        }),
      )
    }),
    (info) => Workspace.use.remove(info.id).pipe(Effect.ignore),
  )

const insertLegacyAssistantMessage = (sessionID: SessionIDType, seq = 1, time = seq) =>
  Effect.gen(function* () {
    const message = SessionMessage.Assistant.make({
      id: SessionMessage.ID.create(),
      type: "assistant",
      agent: "build",
      model: {
        id: ModelV2.ID.make("model"),
        providerID: ProviderV2.ID.make("provider"),
        variant: ModelV2.VariantID.make("default"),
      },
      time: { created: DateTime.makeUnsafe(time) },
      content: [],
    })
    const { db } = yield* Database.Service
    yield* db
      .insert(SessionMessageTable)
      .values([
        {
          id: message.id,
          session_id: sessionID,
          type: message.type,
          seq,
          time_created: time,
          data: {
            time: { created: time },
            agent: message.agent,
            model: message.model,
            content: message.content,
          } as NonNullable<(typeof SessionMessageTable.$inferInsert)["data"]>,
        },
      ])
      .run()
      .pipe(Effect.orDie)
    return message
  })

const insertCorruptV2Message = (sessionID: SessionIDType, time = 1) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(SessionMessageTable)
      .values([
        {
          id: SessionMessage.ID.create(),
          session_id: sessionID,
          type: "assistant",
          seq: time,
          time_created: time,
          data: {} as NonNullable<(typeof SessionMessageTable.$inferInsert)["data"]>,
        },
      ])
      .run()
      .pipe(Effect.orDie)
  })

const setLegacySummaryDiff = (sessionID: SessionIDType) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .update(SessionTable)
      .set({
        summary_additions: 1,
        summary_deletions: 0,
        summary_files: 1,
        summary_diffs: [{ additions: 1, deletions: 0 }],
      })
      .where(eq(SessionTable.id, sessionID))
      .run()
      .pipe(Effect.orDie)
  })

const getWorkspaceID = (sessionID: SessionIDType) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return yield* db
      .select({ workspaceID: SessionTable.workspace_id })
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID))
      .get()
      .pipe(Effect.orDie)
  })

const clearSessionPath = (sessionID: SessionIDType) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db.update(SessionTable).set({ path: null }).where(eq(SessionTable.id, sessionID)).run().pipe(Effect.orDie)
  })

function request(path: string, init?: RequestInit) {
  const url = new URL(path, "http://localhost")
  return HttpClientRequest.fromWeb(new Request(url, init)).pipe(
    HttpClientRequest.setUrl(url.pathname),
    HttpClient.execute,
  )
}

function json<T>(response: HttpClientResponse.HttpClientResponse) {
  if (response.status !== 200) return response.text.pipe(Effect.flatMap((text) => Effect.die(new Error(text))))
  return response.json.pipe(Effect.map((value) => value as T))
}

function responseJson(response: HttpClientResponse.HttpClientResponse) {
  return response.json
}

function requestJson<T>(path: string, init?: RequestInit) {
  return request(path, init).pipe(Effect.flatMap(json<T>))
}

afterEach(async () => {
  Flag.HENA_EXPERIMENTAL_WORKSPACES = originalWorkspaces
  await disposeAllInstances()
  await resetDatabase()
})

describe("session HttpApi", () => {
  it.effect("maps busy sessions to public session busy errors", () =>
    Effect.gen(function* () {
      const sessionID = SessionID.descending()
      const exit = yield* HttpSessionError.mapBusy(Effect.fail(new Session.BusyError({ sessionID }))).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause)).toMatchObject({
          _tag: "SessionBusyError",
          sessionID,
          message: `Session is busy: ${sessionID}`,
        })
      }
    }),
  )

  it.instance(
    "returns declared not found errors for read routes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-hena-directory": test.directory }
        const missingSession = SessionID.descending()
        const missingSessionBody = {
          name: "NotFoundError",
          data: { message: `Session not found: ${missingSession}` },
        }

        const get = yield* request(pathFor(SessionPaths.get, { sessionID: missingSession }), { headers })
        expect(get.status).toBe(404)
        expect(yield* responseJson(get)).toEqual(missingSessionBody)

        const children = yield* request(pathFor(SessionPaths.children, { sessionID: missingSession }), { headers })
        expect(children.status).toBe(404)
        expect(yield* responseJson(children)).toEqual(missingSessionBody)

        const todo = yield* request(pathFor(SessionPaths.todo, { sessionID: missingSession }), { headers })
        expect(todo.status).toBe(404)
        expect(yield* responseJson(todo)).toEqual(missingSessionBody)

        const messages = yield* request(pathFor(SessionPaths.messages, { sessionID: missingSession }), { headers })
        expect(messages.status).toBe(404)
        expect(yield* responseJson(messages)).toEqual(missingSessionBody)

        const remove = yield* request(pathFor(SessionPaths.remove, { sessionID: missingSession }), {
          headers,
          method: "DELETE",
        })
        expect(remove.status).toBe(404)
        expect(yield* responseJson(remove)).toEqual(missingSessionBody)

        const prompt = yield* request(pathFor(SessionPaths.prompt, { sessionID: missingSession }), {
          headers: { ...headers, "content-type": "application/json" },
          method: "POST",
          body: JSON.stringify({ agent: "build", noReply: true, parts: [{ type: "text", text: "hello" }] }),
        })
        expect(prompt.status).toBe(404)
        expect(yield* responseJson(prompt)).toEqual(missingSessionBody)

        const abort = yield* request(pathFor(SessionPaths.abort, { sessionID: missingSession }), {
          headers,
          method: "POST",
        })
        expect(abort.status).toBe(200)
        expect(yield* responseJson(abort)).toBe(true)

        const session = yield* createSession({ title: "missing message" })
        const missingMessage = MessageID.ascending()
        const message = yield* request(
          pathFor(SessionPaths.message, { sessionID: session.id, messageID: missingMessage }),
          { headers },
        )
        expect(message.status).toBe(404)
        expect(yield* responseJson(message)).toEqual({
          name: "NotFoundError",
          data: { message: `Message not found: ${missingMessage}` },
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "serves read routes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-hena-directory": test.directory }
        const parent = yield* createSession({ title: "parent" })
        const child = yield* createSession({ title: "child", parentID: parent.id })
        const message = yield* createTextMessage(parent.id, "hello")
        yield* createTextMessage(parent.id, "world")

        const listed = yield* requestJson<Session.Info[]>(`${SessionPaths.list}?roots=true`, { headers })
        expect(listed.map((item) => item.id)).toContain(parent.id)
        expect(Object.hasOwn(listed[0]!, "parentID")).toBe(false)

        expect(yield* requestJson<Record<string, unknown>>(SessionPaths.status, { headers })).toEqual({})

        expect(
          yield* requestJson<Session.Info>(pathFor(SessionPaths.get, { sessionID: parent.id }), { headers }),
        ).toMatchObject({ id: parent.id, title: "parent" })

        expect(
          (yield* requestJson<Session.Info[]>(pathFor(SessionPaths.children, { sessionID: parent.id }), {
            headers,
          })).map((item) => item.id),
        ).toEqual([child.id])

        expect(
          yield* requestJson<unknown[]>(pathFor(SessionPaths.todo, { sessionID: parent.id }), { headers }),
        ).toEqual([])

        expect(
          yield* requestJson<unknown[]>(pathFor(SessionPaths.diff, { sessionID: parent.id }), { headers }),
        ).toEqual([])

        const messages = yield* request(`${pathFor(SessionPaths.messages, { sessionID: parent.id })}?limit=1`, {
          headers,
        })
        const messagePage = yield* json<SessionV1.WithParts[]>(messages)
        const nextCursor = messages.headers["x-next-cursor"]
        expect(nextCursor).toBeTruthy()
        expect(messagePage[0]?.parts[0]).toMatchObject({ type: "text" })

        expect(
          (yield* request(`${pathFor(SessionPaths.messages, { sessionID: parent.id })}?before=${nextCursor}`, {
            headers,
          })).status,
        ).toBe(400)
        expect(
          (yield* request(`${pathFor(SessionPaths.messages, { sessionID: parent.id })}?limit=1&before=invalid`, {
            headers,
          })).status,
        ).toBe(400)

        expect(
          yield* requestJson<SessionV1.WithParts>(
            pathFor(SessionPaths.message, { sessionID: parent.id, messageID: message.info.id }),
            { headers },
          ),
        ).toMatchObject({ info: { id: message.info.id } })

        yield* insertLegacyAssistantMessage(parent.id)

        expect(
          (yield* requestJson<{ data: SessionMessage.Message[] }>(`/api/session/${parent.id}/message`, {
            headers,
          })).data,
        ).toMatchObject([{ type: "assistant" }])
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.live("uses the persisted session directory for prompt requests", () =>
    Effect.gen(function* () {
      const llm = yield* TestLLMServer
      yield* llm.text("ok", { usage: { input: 1, output: 1 } })

      const config = testProviderConfig(llm.url)
      const sessionDirectory = yield* tmpdirScoped({ git: true, config })
      const requestDirectory = yield* tmpdirScoped({ git: true, config })
      const session = yield* createSession({ title: "directory regression" }).pipe(
        provideInstanceEffect(sessionDirectory),
      )

      const response = yield* request(
        `${pathFor(SessionPaths.prompt, { sessionID: session.id })}?directory=${encodeURIComponent(requestDirectory)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            agent: "build",
            model: { providerID: "test", modelID: "test-model" },
            parts: [{ type: "text", text: "which directory?" }],
          }),
        },
      )

      expect(response.status).toBe(200)
      yield* responseJson(response)

      const messages = yield* Session.use
        .messages({ sessionID: session.id })
        .pipe(provideInstanceEffect(sessionDirectory), Effect.orDie)
      const assistant = messages.find((message) => message.info.role === "assistant")
      expect(assistant?.info.role === "assistant" ? assistant.info.path : undefined).toEqual({
        cwd: sessionDirectory,
        root: sessionDirectory,
      })
    }).pipe(Effect.provide(TestLLMServer.layer), Effect.provide(AppNodeBuilder.build(CrossSpawnSpawner.node))),
  )

  it.live("runs named chat projects through legacy HTTP without workspace tools or context", () =>
    Effect.gen(function* () {
      const llm = yield* TestLLMServer
      yield* llm.text("first reply")
      yield* llm.text("second reply")
      const project = (yield* requestJson<{ data: Project.Info }>("/api/project", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Research chat" }),
      })).data
      expect(project).toMatchObject({ name: "Research chat", mode: "chat" })
      const database = yield* Database.Service
      expect(yield* database.db.select().from(SessionTable).where(eq(SessionTable.project_id, project.id)).all()).toEqual([])
      yield* Effect.promise(() => Bun.write(path.join(project.worktree, "hena.json"), JSON.stringify({
        ...testProviderConfig(llm.url),
        share: "disabled",
        instructions: ["SECRET.md"],
        agent: { build: { prompt: `Private workspace: ${project.worktree}` } },
      })))
      yield* Effect.promise(() => Bun.write(path.join(project.worktree, "SECRET.md"), "PRIVATE WORKSPACE INSTRUCTIONS"))
      const headers = { "x-hena-directory": project.worktree, "content-type": "application/json" }
      const session = yield* requestJson<Session.Info>(SessionPaths.create, {
        method: "POST", headers, body: JSON.stringify({ title: "Research" }),
      })
      expect(session).toMatchObject({ projectID: project.id, metadata: { appRuntime: "legacy" } })
      for (const text of ["first prompt", "second prompt"]) {
        const response = yield* request(pathFor(SessionPaths.prompt, { sessionID: session.id }), {
          method: "POST", headers,
          body: JSON.stringify({ agent: "build", model: { providerID: "test", modelID: "test-model" }, system: "Caller context stays intact.", parts: [{ type: "text", text }] }),
        })
        expect(response.status).toBe(200)
        yield* responseJson(response)
      }
      const inputs = yield* llm.inputs
      expect(inputs).toHaveLength(2)
      for (const input of inputs) {
        const tools = input.tools as { function: { name: string } }[]
        expect(tools.map((tool) => tool.function.name).sort()).toEqual(["question", "todowrite", "webfetch", "websearch"])
        expect(JSON.stringify(input.messages)).not.toContain(project.worktree)
        expect(JSON.stringify(input.messages)).not.toContain("PRIVATE WORKSPACE INSTRUCTIONS")
        expect(JSON.stringify(input.messages)).toContain("Caller context stays intact.")
      }
      expect(JSON.stringify(inputs[1].messages)).toContain("first reply")
      const history = yield* requestJson<SessionV1.WithParts[]>(pathFor(SessionPaths.messages, { sessionID: session.id }), { headers })
      expect(history.map((message) => message.info.role)).toEqual(["user", "assistant", "user", "assistant"])
      for (const part of [{ type: "file", url: "file:///etc/passwd", mime: "text/plain" }, { type: "agent", name: "explore" }]) {
        const response = yield* request(pathFor(SessionPaths.prompt, { sessionID: session.id }), {
          method: "POST", headers, body: JSON.stringify({ parts: [part] }),
        })
        expect(response.status).toBe(400)
      }
      expect(yield* llm.calls).toBe(2)
      yield* llm.tool("question", { questions: [{ header: "Choice", question: "Which option?", options: [{ label: "A", description: "First" }] }] })
      yield* llm.text("answer received")
      expect((yield* request(pathFor(SessionPaths.promptAsync, { sessionID: session.id }), {
        method: "POST", headers,
        body: JSON.stringify({ model: { providerID: "test", modelID: "test-model" }, parts: [{ type: "text", text: "ask me" }] }),
      })).status).toBe(204)
      const question = yield* pollWithTimeout(Effect.gen(function* () {
        return (yield* requestJson<{ id: string; sessionID: string }[]>("/question", { headers })).find((item) => item.sessionID === session.id)
      }), "chat question was not published")
      const pending = yield* requestJson<SessionV1.WithParts[]>(pathFor(SessionPaths.messages, { sessionID: session.id }), { headers })
      expect(pending.flatMap((message) => message.parts).some((part) => part.type === "tool" && part.tool === "question" && part.state.status === "running")).toBe(true)
      expect(yield* requestJson<boolean>(`/question/${question.id}/reply`, {
        method: "POST", headers, body: JSON.stringify({ answers: [["A"]] }),
      })).toBe(true)
      yield* pollWithTimeout(Effect.gen(function* () {
        const messages = yield* requestJson<SessionV1.WithParts[]>(pathFor(SessionPaths.messages, { sessionID: session.id }), { headers })
        return messages.flatMap((message) => message.parts).some((part) => part.type === "text" && part.text === "answer received") ? true : undefined
      }), "chat did not resume after answering")
      yield* llm.hang
      yield* request(pathFor(SessionPaths.promptAsync, { sessionID: session.id }), {
        method: "POST", headers,
        body: JSON.stringify({ model: { providerID: "test", modelID: "test-model" }, parts: [{ type: "text", text: "stop me" }] }),
      })
      yield* llm.wait(5)
      expect(yield* requestJson<boolean>(pathFor(SessionPaths.abort, { sessionID: session.id }), { method: "POST", headers })).toBe(true)
      const stopped = yield* requestJson<SessionV1.WithParts[]>(pathFor(SessionPaths.messages, { sessionID: session.id }), { headers })
      expect(stopped.at(-1)?.info).toMatchObject({ role: "assistant", error: { name: "MessageAbortedError" } })
      const revert = yield* requestJson<Session.Info>(pathFor(SessionPaths.revert, { sessionID: session.id }), {
        method: "POST", headers, body: JSON.stringify({ messageID: history[2].info.id }),
      })
      expect(revert.revert?.messageID).toBe(history[2].info.id)
      expect((yield* requestJson<Session.Info>(pathFor(SessionPaths.unrevert, { sessionID: session.id }), { method: "POST", headers })).revert).toBeUndefined()
      yield* requestJson<Session.Info>(pathFor(SessionPaths.revert, { sessionID: session.id }), {
        method: "POST", headers, body: JSON.stringify({ messageID: history[2].info.id }),
      })
      yield* llm.text("edited reply")
      const edited = yield* request(pathFor(SessionPaths.prompt, { sessionID: session.id }), {
        method: "POST", headers,
        body: JSON.stringify({ model: { providerID: "test", modelID: "test-model" }, parts: [{ type: "text", text: "edited prompt" }] }),
      })
      expect(edited.status).toBe(200)
      yield* responseJson(edited)
      const refreshed = yield* requestJson<SessionV1.WithParts[]>(pathFor(SessionPaths.messages, { sessionID: session.id }), { headers })
      expect(refreshed).toHaveLength(4)
      expect(JSON.stringify(refreshed)).toContain("edited reply")
      expect(JSON.stringify(refreshed)).not.toContain("second reply")
      const saved = (yield* requestJson<{ data: { id: SessionIDType } }>("/api/session", {
        method: "POST", headers,
        body: JSON.stringify({ projectID: project.id, agent: "build", model: { id: "test-model", providerID: "test" } }),
      })).data
      const savedMessage = yield* insertLegacyAssistantMessage(saved.id)
      expect((yield* request(pathFor(SessionPaths.promptAsync, { sessionID: saved.id }), {
        method: "POST", headers, body: JSON.stringify({ parts: [{ type: "text", text: "do not mix transcripts" }] }),
      })).status).toBe(400)
      yield* llm.hang
      yield* request(pathFor(SessionPaths.promptAsync, { sessionID: session.id }), {
        method: "POST", headers,
        body: JSON.stringify({ model: { providerID: "test", modelID: "test-model" }, parts: [{ type: "text", text: "attach while running" }] }),
      })
      yield* llm.wait(7)
      const beforeAttach = yield* requestJson<SessionV1.WithParts[]>(pathFor(SessionPaths.messages, { sessionID: session.id }), { headers })
      const target = yield* tmpdirScoped()
      const attach = yield* request(`/api/project/${project.id}/attach`, {
        method: "POST", headers, body: JSON.stringify({ directory: target }),
      })
      expect({ status: attach.status, body: yield* attach.text }).toEqual({ status: 204, body: "" })
      const attached = yield* requestJson<Session.Info>(pathFor(SessionPaths.get, { sessionID: session.id }), { headers })
      expect(attached).toMatchObject({ id: session.id, projectID: project.id, directory: target })
      const attachedHistory = yield* requestJson<SessionV1.WithParts[]>(pathFor(SessionPaths.messages, { sessionID: session.id }), { headers })
      expect(attachedHistory.map((message) => message.info.id)).toEqual(beforeAttach.map((message) => message.info.id))
      expect(attachedHistory.at(-1)?.info).toMatchObject({ role: "assistant", error: { name: "MessageAbortedError" } })
      expect(yield* requestJson<Session.Info>(pathFor(SessionPaths.get, { sessionID: saved.id }), { headers }))
        .toMatchObject({ id: saved.id, directory: target, metadata: { appRuntime: "canonical" } })
      const listed = yield* requestJson<Session.Info[]>(`${SessionPaths.list}?directory=${encodeURIComponent(target)}`, {
        headers: { "x-hena-directory": target },
      })
      expect(listed.find((item) => item.id === saved.id)?.metadata?.appRuntime).toBe("canonical")
      expect(listed.find((item) => item.id === session.id)?.metadata?.appRuntime).toBe("legacy")
      expect((yield* requestJson<{ data: SessionMessage.Message[] }>(`/api/session/${saved.id}/message`, { headers })).data)
        .toMatchObject([{ id: savedMessage.id, type: "assistant" }])
      expect((yield* database.db.select().from(SessionTable).where(eq(SessionTable.id, saved.id)).get())?.metadata).toBeNull()
      yield* llm.text("workspace reply")
      const workspace = yield* request(pathFor(SessionPaths.prompt, { sessionID: session.id }), {
        method: "POST", headers,
        body: JSON.stringify({ model: { providerID: "test", modelID: "test-model" }, parts: [{ type: "text", text: "continue in workspace" }] }),
      })
      expect(workspace.status).toBe(200)
      yield* responseJson(workspace)
      const workspaceInput = (yield* llm.inputs).at(-1)!
      expect(JSON.stringify(workspaceInput.tools)).toContain('"read"')
      expect(JSON.stringify(workspaceInput.messages)).toContain(target)
    }).pipe(Effect.provide(TestLLMServer.layer), Effect.provide(AppNodeBuilder.build(CrossSpawnSpawner.node))),
  )

  it.instance(
    "returns v2 public request errors for cursor and workspace query failures",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-hena-directory": test.directory }
        const session = yield* createSession({ title: "v2 cursor" })
        const firstMessage = yield* insertLegacyAssistantMessage(session.id, 1, 2)
        const secondMessage = yield* insertLegacyAssistantMessage(session.id, 2, 1)

        const sessionPage = yield* request(
          `/api/session?${new URLSearchParams({
            limit: "1",
            order: "asc",
            directory: test.directory,
            search: "v2",
          })}`,
          { headers },
        )
        const sessionCursor = (yield* json<{ data: Session.Info[]; cursor: { next?: string } }>(sessionPage)).cursor
          .next
        expect(sessionCursor).toBeTruthy()
        expect(JSON.parse(Buffer.from(sessionCursor!, "base64url").toString("utf8"))).toMatchObject({
          order: "asc",
          directory: test.directory,
          search: "v2",
          anchor: { id: session.id, direction: "next" },
        })

        const sessionNextPage = yield* request(`/api/session?cursor=${sessionCursor}`, { headers })
        expect(sessionNextPage.status).toBe(200)

        const invalidSessionCursor = yield* request(`/api/session?cursor=invalid`, { headers })
        expect(invalidSessionCursor.status).toBe(400)
        expect(yield* responseJson(invalidSessionCursor)).toMatchObject({
          _tag: "InvalidCursorError",
          message: "Invalid cursor",
        })

        const invalidWorkspace = yield* request(`/api/session?workspace=bad`, { headers })
        expect(invalidWorkspace.status).toBe(400)
        expect(yield* responseJson(invalidWorkspace)).toMatchObject({
          _tag: "InvalidRequestError",
          kind: "Query",
        })

        const messagePage = yield* request(`/api/session/${session.id}/message?limit=1`, { headers })
        const messageBody = yield* json<{ data: SessionMessage.Message[]; cursor: { next?: string } }>(messagePage)
        const messageCursor = messageBody.cursor.next
        expect(messageCursor).toBeTruthy()
        expect(messageBody.data.map((message) => message.id)).toEqual([secondMessage.id])
        expect(JSON.parse(Buffer.from(messageCursor!, "base64url").toString("utf8"))).toEqual({
          id: secondMessage.id,
          order: "desc",
          direction: "next",
        })

        const nextMessagePage = yield* request(`/api/session/${session.id}/message?cursor=${messageCursor}`, {
          headers,
        })
        expect(
          (yield* json<{ data: SessionMessage.Message[] }>(nextMessagePage)).data.map((message) => message.id),
        ).toEqual([firstMessage.id])

        const legacyMessageCursor = Buffer.from(
          JSON.stringify({ id: secondMessage.id, time: 1, order: "desc", direction: "next" }),
        ).toString("base64url")
        const legacyMessagePage = yield* request(`/api/session/${session.id}/message?cursor=${legacyMessageCursor}`, {
          headers,
        })
        expect(
          (yield* json<{ data: SessionMessage.Message[] }>(legacyMessagePage)).data.map((message) => message.id),
        ).toEqual([firstMessage.id])

        const messageCursorWithOrder = yield* request(
          `/api/session/${session.id}/message?cursor=${messageCursor}&order=asc`,
          { headers },
        )
        expect(messageCursorWithOrder.status).toBe(400)
        expect(yield* responseJson(messageCursorWithOrder)).toMatchObject({
          _tag: "InvalidCursorError",
          message: "Cursor cannot be combined with order",
        })

        const invalidMessageCursor = yield* request(`/api/session/${session.id}/message?cursor=invalid`, { headers })
        expect(invalidMessageCursor.status).toBe(400)
        expect(yield* responseJson(invalidMessageCursor)).toMatchObject({
          _tag: "InvalidCursorError",
          message: "Invalid cursor",
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "returns v2 public not found errors for missing sessions",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-hena-directory": test.directory }
        const missing = SessionID.descending()
        const expected = {
          _tag: "SessionNotFoundError",
          sessionID: missing,
          message: `Session not found: ${missing}`,
        }

        const messages = yield* request(`/api/session/${missing}/message`, { headers })
        expect(messages.status).toBe(404)
        expect(yield* responseJson(messages)).toEqual(expected)

        const context = yield* request(`/api/session/${missing}/context`, { headers })
        expect(context.status).toBe(404)
        expect(yield* responseJson(context)).toEqual(expected)

        const compact = yield* request(`/api/session/${missing}/compact`, { method: "POST", headers })
        expect(compact.status).toBe(404)
        expect(yield* responseJson(compact)).toEqual(expected)

        const wait = yield* request(`/api/session/${missing}/wait`, { method: "POST", headers })
        expect(wait.status).toBe(404)
        expect(yield* responseJson(wait)).toEqual(expected)

        const prompt = yield* request(`/api/session/${missing}/prompt`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ prompt: { text: "hello" } }),
        })
        expect(prompt.status).toBe(404)
        expect(yield* responseJson(prompt)).toEqual(expected)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "durably records one v2 prompt for exact message-ID retries",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-hena-directory": test.directory }
        const session = yield* createSession({ title: "v2 prompt recording" })

        const recordPrompt = () =>
          request(`/api/session/${session.id}/prompt`, {
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({ id: "msg_http_prompt", prompt: { text: "hello" }, resume: false }),
          })
        const first = yield* recordPrompt()
        const retried = yield* recordPrompt()
        type PromptBody = { id: string; prompt: { text: string }; delivery: string; promotedSeq?: number }
        const firstBody = yield* json<{ data: PromptBody }>(first)
        const retriedBody = yield* json<{ data: PromptBody }>(retried)
        expect(first.status).toBe(200)
        expect(retried.status).toBe(200)
        expect(retriedBody).toEqual(firstBody)
        expect(firstBody).toMatchObject({
          data: { id: "msg_http_prompt", prompt: { text: "hello" }, delivery: "steer" },
        })

        const messages = yield* requestJson<{ data: PromptBody[] }>(`/api/session/${session.id}/message`, {
          headers,
        })
        expect(messages.data).toHaveLength(0)
        const admitted = yield* Database.Service.use(({ db }) =>
          db
            .select()
            .from(SessionInputTable)
            .where(eq(SessionInputTable.id, SessionMessage.ID.make("msg_http_prompt")))
            .get()
            .pipe(Effect.orDie),
        )
        expect(admitted).toMatchObject({
          id: "msg_http_prompt",
          session_id: session.id,
          delivery: "steer",
          promoted_seq: null,
        })
        const conflict = yield* request(`/api/session/${session.id}/prompt`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ id: "msg_http_prompt", prompt: { text: "goodbye" } }),
        })
        expect(conflict.status).toBe(409)
        expect(yield* responseJson(conflict)).toEqual({
          _tag: "ConflictError",
          message: "Prompt message ID conflicts with an existing durable record: msg_http_prompt",
          resource: "msg_http_prompt",
        })

        const wakeID = SessionMessage.ID.make("msg_http_wake")
        const wake = yield* request(`/api/session/${session.id}/prompt`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ id: wakeID, prompt: { text: "hello again" } }),
        })
        expect(wake.status).toBe(200)
        const message = yield* pollWithTimeout(
          requestJson<{ data: SessionMessage.Message[] }>(`/api/session/${session.id}/message`, { headers }).pipe(
            Effect.map(({ data }) => data.find((message) => message.id === wakeID)),
          ),
          "V2 prompt was not promoted after wake",
          "10 seconds",
        )
        expect(message).toMatchObject({ id: wakeID, type: "user" })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance("classifies inbox-only canonical sessions in get, lists, children, and compatibility events", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = { "x-hena-directory": test.directory, "content-type": "application/json" }
      const parent = yield* createSession({ title: "parent" })
      const child = yield* createSession({ title: "pending", parentID: parent.id, metadata: { appRuntime: "legacy" } })
      expect((yield* request(`/api/session/${child.id}/prompt`, {
        method: "POST", headers,
        body: JSON.stringify({ id: "msg_pending_runtime", prompt: { text: "admit only" }, resume: false }),
      })).status).toBe(200)
      expect((yield* requestJson<{ data: unknown[] }>(`/api/session/${child.id}/message`, { headers })).data).toEqual([])
      expect((yield* requestJson<Session.Info>(pathFor(SessionPaths.get, { sessionID: child.id }), { headers })).metadata?.appRuntime).toBe("canonical")
      for (const route of [SessionPaths.list, ExperimentalPaths.session, pathFor(SessionPaths.children, { sessionID: parent.id })]) {
        expect((yield* requestJson<Session.Info[]>(route, { headers })).find((item) => item.id === child.id)?.metadata?.appRuntime).toBe("canonical")
      }
      const seen: unknown[] = []
      const listener = (event: GlobalEvent) => { seen.push(event.payload) }
      GlobalBus.on("event", listener)
      yield* Effect.addFinalizer(() => Effect.sync(() => { GlobalBus.off("event", listener) }))
      // Publish an incomplete compatibility update directly; the read boundary must enrich it.
      const events = yield* EventV2Bridge.Service
      yield* events.publish(SessionV1.Event.Updated, { sessionID: child.id, info: { ...child, title: "updated" } })
      expect(seen).toContainEqual(expect.objectContaining({
        type: "session.updated",
        properties: expect.objectContaining({ info: expect.objectContaining({ id: child.id, metadata: { appRuntime: "canonical" } }) }),
      }))
    }),
    { git: true, config: { formatter: false, lsp: false, share: "disabled" } },
  )

  it.live("App runtime actions answer, reject, and stop existing canonical chats over HTTP", () =>
    Effect.gen(function* () {
      const llm = yield* TestLLMServer
      const project = (yield* requestJson<{ data: Project.Info }>("/api/project", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Saved canonical chat" }),
      })).data
      yield* Effect.promise(() => Bun.write(path.join(project.worktree, "hena.json"), JSON.stringify({
        providers: { test: {
          api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: llm.url },
          request: { body: { apiKey: "test-key" } },
          models: { "test-model": { capabilities: { tools: true, input: ["text"], output: ["text"] }, limit: { context: 100_000, output: 10_000 } } },
        } },
      })))
      const server = yield* HttpServer.HttpServer
      if (server.address._tag !== "TcpAddress") return yield* Effect.die("Expected a TCP test server")
      const client = createHenaClient({ baseUrl: `http://127.0.0.1:${server.address.port}`, directory: project.worktree, throwOnError: true })
      const created = yield* Effect.promise(() => client.v2.session.create({ projectID: project.id, agent: "build", model: { id: "test-model", providerID: "test" } }))
      const sessionID = created.data!.data.id
      const seen: unknown[] = []
      const listener = (event: GlobalEvent) => { seen.push(event.payload) }
      GlobalBus.on("event", listener)
      yield* Effect.addFinalizer(() => Effect.sync(() => { GlobalBus.off("event", listener) }))
      const questions = { questions: [{ header: "Choice", question: "Pick one", options: [{ label: "A", description: "First" }] }] }
      for (const action of ["reply", "reject", "stop"] as const) {
        yield* llm.tool("question", questions)
        if (action === "reply") yield* llm.text("reply resumed")
        yield* Effect.promise(() => client.v2.session.prompt({ sessionID, prompt: { text: action } }))
        const pending = yield* pollWithTimeout(Effect.promise(() => pendingQuestions(client, project.worktree)).pipe(
          Effect.map((result) => result.data.find((item) => item.sessionID === sessionID)),
        ), "canonical question was not hydrated through the App helper", "10 seconds")
        expect(pending.appRuntime).toBe("canonical")
        if (action === "stop") {
          yield* Effect.promise(() => interruptSession(client, sessionID))
        } else {
          yield* Effect.promise(() => respondToQuestion(client, pending, action === "reply" ? [["A"]] : undefined))
          if (action === "reply") yield* pollWithTimeout(Effect.promise(() => client.v2.session.messages({ sessionID })).pipe(
            Effect.map((result) => JSON.stringify(result.data?.data).includes(`${action} resumed`) ? true : undefined),
          ), "canonical execution did not resume")
        }
        yield* pollWithTimeout(Effect.promise(() => client.v2.session.active()).pipe(
          Effect.map((result) => {
            const status = result.data?.data[sessionID]
            return status && typeof status === "object" && "type" in status && status.type === "running" ? undefined : true
          }),
        ), "canonical execution did not become idle")
        expect((yield* Effect.promise(() => pendingQuestions(client, project.worktree))).data).toEqual([])
        expect(seen).toContainEqual(expect.objectContaining({
          type: action === "reply" ? "question.v2.replied" : "question.v2.rejected",
          properties: expect.objectContaining({ sessionID, requestID: pending.id }),
        }))
      }
      expect(yield* llm.calls).toBe(5)
    }).pipe(Effect.provide(TestLLMServer.layer), Effect.provide(AppNodeBuilder.build(CrossSpawnSpawner.node))),
    { timeout: 20000 },
  )

  it.live("replaces a staged persisted prompt through the mounted v2 HttpApi", () =>
    Effect.gen(function* () {
      const llm = yield* TestLLMServer
      yield* llm.text("first", { usage: { input: 1, output: 1 } })
      yield* llm.text("replacement", { usage: { input: 1, output: 1 } })
      const directory = yield* tmpdirScoped({
        git: true,
        init: (directory) =>
          Effect.promise(() =>
            Bun.write(
              path.join(directory, "hena.json"),
              JSON.stringify({
                providers: {
                  test: {
                    api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: llm.url },
                    request: { body: { apiKey: "test-key" } },
                    models: {
                      "test-model": {
                        capabilities: { tools: true, input: ["text"], output: ["text"] },
                        limit: { context: 100_000, output: 10_000 },
                      },
                    },
                  },
                },
              }),
            ),
          ).pipe(Effect.asVoid),
      })
      const headers = { "x-hena-directory": directory, "content-type": "application/json" }
      const model = { providerID: "test", id: "test-model" }

      const created = yield* request("/api/session", {
        method: "POST",
        headers,
        body: JSON.stringify({ location: { directory }, model }),
      })
      expect(created.status).toBe(200)
      const session = (yield* responseJson(created)) as { data: Session.Info }

      const switchedAgent = yield* request(`/api/session/${session.data.id}/agent`, {
        method: "POST",
        headers,
        body: JSON.stringify({ agent: "plan" }),
      })
      expect(switchedAgent.status).toBe(204)

      const prompted = yield* request(`/api/session/${session.data.id}/prompt`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: "msg_http_revert", prompt: { text: "original" } }),
      })
      expect(prompted.status).toBe(200)
      yield* pollWithTimeout(
        requestJson<{ data: SessionMessage.Message[] }>(`/api/session/${session.data.id}/message`, { headers }).pipe(
          Effect.map(({ data }) => data.find((message) => message.id === "msg_http_revert")),
        ),
        "V2 prompt was not persisted before revert",
        "10 seconds",
      )

      const staged = yield* request(`/api/session/${session.data.id}/revert/stage`, {
        method: "POST",
        headers,
        body: JSON.stringify({ messageID: "msg_http_revert", files: false }),
      })
      expect(staged.status).toBe(200)

      const replace = (selected = model) =>
        request(`/api/session/${session.data.id}/revert/replace`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            messageID: "msg_http_revert",
            id: "msg_http_replacement",
            prompt: { text: "replacement" },
            agent: "build",
            model: selected,
          }),
        })
      const unavailable = yield* replace({ providerID: "missing", id: "missing" })
      expect(unavailable.status).toBe(409)
      expect(yield* responseJson(unavailable)).toMatchObject({
        _tag: "ConflictError",
        message: "Model unavailable: missing/missing",
      })
      const replaced = yield* replace()
      const replacementBody = yield* responseJson(replaced)
      expect(replaced.status).toBe(200)
      expect(replacementBody).toMatchObject({
        data: { id: "msg_http_replacement", prompt: { text: "replacement" }, delivery: "steer" },
      })

      yield* Database.Service.use(({ db }) =>
        db
          .update(EventTable)
          .set({
            data: {
              sessionID: session.data.id,
              timestamp: Date.now(),
              messageID: "msg_http_revert",
              replacement: { messageID: "msg_http_replacement" },
            },
          })
          .where(
            and(
              eq(EventTable.aggregate_id, session.data.id),
              eq(EventTable.type, "session.next.revert.committed.1"),
            ),
          )
          .run()
          .pipe(Effect.orDie),
      )
      const corruptRetry = yield* replace()
      const corruptBody = yield* responseJson(corruptRetry)
      expect(corruptRetry.status).toBe(500)
      expect(corruptBody).toMatchObject({
        _tag: "UnknownError",
        message: "Unexpected server error. Check server logs for details.",
      })
      expect((corruptBody as { ref?: unknown }).ref).toMatch(/^err_[0-9a-f-]{8}$/)
    }).pipe(Effect.provide(TestLLMServer.layer), Effect.provide(AppNodeBuilder.build(CrossSpawnSpawner.node))),
  )

  it.instance(
    "returns v2 public unavailable errors for unfinished session mutations",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-hena-directory": test.directory }
        const session = yield* createSession({ title: "v2 unavailable" })

        const compact = yield* request(`/api/session/${session.id}/compact`, { method: "POST", headers })
        expect(compact.status).toBe(503)
        expect(yield* responseJson(compact)).toEqual({
          _tag: "ServiceUnavailableError",
          message: "Session compact is not available yet",
          service: "session.compact",
        })

        const wait = yield* request(`/api/session/${session.id}/wait`, { method: "POST", headers })
        expect(wait.status).toBe(503)
        expect(yield* responseJson(wait)).toEqual({
          _tag: "ServiceUnavailableError",
          message: "Session wait is not available yet",
          service: "session.wait",
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "returns safe v2 unknown errors for corrupt projected messages",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* createSession({ title: "v2 corrupt message" })
        yield* insertCorruptV2Message(session.id)

        const messages = yield* request(`/api/session/${session.id}/message`, {
          headers: { "x-hena-directory": test.directory },
        })
        const messagesBody = yield* responseJson(messages)
        expect(messages.status).toBe(500)
        expect(messagesBody).toMatchObject({
          _tag: "UnknownError",
          message: "Unexpected server error. Check server logs for details.",
        })
        expect((messagesBody as { ref?: unknown }).ref).toMatch(/^err_[0-9a-f-]{8}$/)
        expect(JSON.stringify(messagesBody)).not.toContain("assistant")

        const context = yield* request(`/api/session/${session.id}/context`, {
          headers: { "x-hena-directory": test.directory },
        })
        const contextBody = yield* responseJson(context)
        expect(context.status).toBe(500)
        expect(contextBody).toMatchObject({
          _tag: "UnknownError",
          message: "Unexpected server error. Check server logs for details.",
        })
        expect((contextBody as { ref?: unknown }).ref).toMatch(/^err_[0-9a-f-]{8}$/)
        expect(JSON.stringify(contextBody)).not.toContain("assistant")
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "serves sessions with migrated summary diffs missing file details",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* createSession({ title: "legacy diff" })
        yield* setLegacySummaryDiff(session.id)

        const response = yield* request(pathFor(SessionPaths.get, { sessionID: session.id }), {
          headers: { "x-hena-directory": test.directory },
        })

        expect(response.status).toBe(200)
        expect((yield* json<Session.Info>(response)).summary?.diffs).toEqual([{ additions: 1, deletions: 0 }])
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "serves lifecycle mutation routes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-hena-directory": test.directory, "content-type": "application/json" }

        const createdEmpty = yield* requestJson<Session.Info>(SessionPaths.create, {
          method: "POST",
          headers,
        })
        expect(createdEmpty.id).toBeTruthy()

        const created = yield* requestJson<Session.Info>(SessionPaths.create, {
          method: "POST",
          headers,
          body: JSON.stringify({ title: "created" }),
        })
        expect(created.title).toBe("created")

        const updated = yield* requestJson<Session.Info>(pathFor(SessionPaths.update, { sessionID: created.id }), {
          method: "PATCH",
          headers,
          body: JSON.stringify({ title: "updated", time: { archived: 1 } }),
        })
        expect(updated).toMatchObject({ id: created.id, title: "updated", time: { archived: 1 } })

        const forked = yield* requestJson<Session.Info>(pathFor(SessionPaths.fork, { sessionID: created.id }), {
          method: "POST",
          headers,
        })
        expect(forked.id).not.toBe(created.id)

        const forkedWithoutContentType = yield* requestJson<Session.Info>(
          pathFor(SessionPaths.fork, { sessionID: created.id }),
          {
            method: "POST",
            headers: { "x-hena-directory": test.directory },
          },
        )
        expect(forkedWithoutContentType.id).not.toBe(created.id)

        const invalidFork = yield* request(pathFor(SessionPaths.fork, { sessionID: created.id }), {
          method: "POST",
          headers,
          body: "{",
        })
        expect(invalidFork.status).toBe(400)

        const forkedWhitespace = yield* requestJson<Session.Info>(
          pathFor(SessionPaths.fork, { sessionID: created.id }),
          {
            method: "POST",
            headers,
            body: "  \n",
          },
        )
        expect(forkedWhitespace.id).not.toBe(created.id)

        expect(
          yield* requestJson<boolean>(pathFor(SessionPaths.abort, { sessionID: created.id }), {
            method: "POST",
            headers,
          }),
        ).toBe(true)

        expect(
          yield* requestJson<boolean>(pathFor(SessionPaths.remove, { sessionID: created.id }), {
            method: "DELETE",
            headers,
          }),
        ).toBe(true)
      }),
    { git: true, config: { formatter: false, lsp: false, share: "disabled" } },
  )

  it.instance(
    "persists selected workspace id when creating a session",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        Flag.HENA_EXPERIMENTAL_WORKSPACES = true
        const project = yield* Project.use.fromDirectory(test.directory)
        const workspace = yield* createLocalWorkspace({
          projectID: project.project.id,
          type: "session-create-workspace",
          directory: path.join(test.directory, ".workspace-local"),
        })

        const created = yield* requestJson<Session.Info>(`${SessionPaths.create}?workspace=${workspace.id}`, {
          method: "POST",
          headers: { "x-hena-directory": test.directory, "content-type": "application/json" },
          body: JSON.stringify({ title: "workspace session" }),
        })
        const messages = yield* request(
          `${pathFor(SessionPaths.messages, { sessionID: created.id })}?workspace=${workspace.id}`,
          {
            headers: { "x-hena-directory": test.directory },
          },
        )

        expect(created).toMatchObject({ id: created.id, workspaceID: workspace.id })
        expect(messages.status).toBe(200)
        expect(yield* getWorkspaceID(created.id)).toEqual({ workspaceID: workspace.id })
      }),
    { git: true, config: { formatter: false, lsp: false, share: "disabled" } },
  )

  it.instance(
    "validates archived timestamp values",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-hena-directory": test.directory, "content-type": "application/json" }
        const session = yield* createSession({ title: "archived" })
        const body = JSON.stringify({ time: { archived: -1 } })

        const response = yield* request(pathFor(SessionPaths.update, { sessionID: session.id }), {
          method: "PATCH",
          headers,
          body,
        })
        expect(response.status).toBe(200)
        expect((yield* json<Session.Info>(response)).time.archived).toBe(-1)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "uses project-scoped path and directory precedence",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const currentDir = path.join(test.directory, "packages", "hena", "src")
        yield* Effect.promise(() => mkdir(currentDir, { recursive: true }))

        const store = yield* InstanceStore.Service
        const { pathSession, pathlessSession } = yield* store.provide(
          { directory: currentDir },
          Effect.gen(function* () {
            return {
              pathSession: yield* createSession(),
              pathlessSession: yield* createSession(),
            }
          }).pipe(Effect.provideService(TestInstance, { directory: currentDir })),
        )
        yield* clearSessionPath(pathlessSession.id)

        const query = new URLSearchParams({
          scope: "project",
          path: "packages/hena/src",
          directory: currentDir,
        })
        const headers = { "x-hena-directory": test.directory }
        const sessions = (yield* json<Session.Info[]>(
          yield* request(`${SessionPaths.list}?${query}`, { headers }),
        )).map((item) => item.id)

        expect(sessions).toContain(pathSession.id)
        expect(sessions).not.toContain(pathlessSession.id)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "lists sessions created through an equivalent directory hint",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const hint = test.directory + path.sep
        const headers = { "x-hena-directory": hint, "content-type": "application/json" }
        const created = yield* requestJson<Session.Info>(SessionPaths.create, {
          method: "POST",
          headers,
          body: JSON.stringify({ title: "hinted" }),
        })

        const query = new URLSearchParams({ directory: hint, roots: "true" })
        const listed = yield* requestJson<Session.Info[]>(`${SessionPaths.list}?${query}`, { headers })
        expect(listed.map((item) => item.id)).toContain(created.id)

        const globalQuery = new URLSearchParams({ directory: hint })
        const global = yield* requestJson<Session.Info[]>(`${ExperimentalPaths.session}?${globalQuery}`, { headers })
        expect(global.map((item) => item.id)).toContain(created.id)
      }),
    { git: true, config: { formatter: false, lsp: false, share: "disabled" } },
  )

  it.instance(
    "lists Windows sessions for equivalent directory spellings",
    () =>
      Effect.gen(function* () {
        if (process.platform !== "win32") return
        const test = yield* TestInstance
        const headers = { "x-hena-directory": test.directory, "content-type": "application/json" }
        const created = yield* requestJson<Session.Info>(SessionPaths.create, {
          method: "POST",
          headers,
          body: JSON.stringify({ title: "windows spelling" }),
        })

        const forwardSlashes = test.directory.replaceAll("\\", "/")
        const lowercaseDrive = test.directory.replace(/^[A-Z]:/, (drive) => drive.toLowerCase())
        const trailingSeparator = `${test.directory}\\`
        for (const spelling of [forwardSlashes, lowercaseDrive, trailingSeparator]) {
          const query = new URLSearchParams({ directory: spelling, roots: "true" })
          const listed = yield* requestJson<Session.Info[]>(`${SessionPaths.list}?${query}`, { headers })
          expect({ spelling, ids: listed.map((item) => item.id) }).toEqual({ spelling, ids: [created.id] })
        }
      }),
    { git: true, config: { formatter: false, lsp: false, share: "disabled" } },
    { timeout: 15000 },
  )

  it.instance(
    "lists Windows sessions created through the global worktree sentinel",
    () =>
      Effect.gen(function* () {
        if (process.platform !== "win32") return
        const globalWorktreeSentinel = "/"
        const headers = { "x-hena-directory": globalWorktreeSentinel, "content-type": "application/json" }
        const driveRootSession = yield* requestJson<Session.Info>(SessionPaths.create, {
          method: "POST",
          headers,
          body: JSON.stringify({ title: "created at drive root" }),
        })
        expect(driveRootSession.directory).toMatch(/^[A-Za-z]:\\$/)

        const query = new URLSearchParams({ directory: globalWorktreeSentinel, roots: "true" })
        const listed = yield* requestJson<Session.Info[]>(`${SessionPaths.list}?${query}`, { headers })
        expect(listed.map((item) => item.id)).toContain(driveRootSession.id)
      }),
    { git: true, config: { formatter: false, lsp: false, share: "disabled" } },
    { timeout: 15000 },
  )

  it.instance(
    "serves paginated message link headers",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-hena-directory": test.directory }
        const session = yield* createSession({ title: "messages" })
        yield* createTextMessage(session.id, "first")
        yield* createTextMessage(session.id, "second")
        const route = `${pathFor(SessionPaths.messages, { sessionID: session.id })}?limit=1`

        const response = yield* request(route, { headers })

        expect(response.headers["x-next-cursor"]).toBeTruthy()
        expect(response.headers["link"]).toContain("limit=1")
        expect(response.headers["access-control-expose-headers"]?.toLowerCase()).toContain("x-next-cursor")
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance("terminates canonical sequence cursors at exact page boundaries in both directions", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const headers = { "x-hena-directory": test.directory }
      const session = yield* createSession({ title: "canonical sequence boundaries" })
      // Invert insertion/ID order while keeping timestamps tied.
      const third = yield* insertLegacyAssistantMessage(session.id, 3, 1)
      const first = yield* insertLegacyAssistantMessage(session.id, 1, 1)
      const second = yield* insertLegacyAssistantMessage(session.id, 2, 1)
      type Page = { data: { id: string }[]; cursor: { next?: string | null; previous?: string | null } }
      for (const order of ["asc", "desc"] as const) {
        const expected = order === "asc" ? [first.id, second.id, third.id] : [third.id, second.id, first.id]
        const start = yield* requestJson<Page>(`/api/session/${session.id}/message?limit=1&order=${order}`, { headers })
        expect(start.data.map((message) => message.id)).toEqual(expected.slice(0, 1))
        expect(start.cursor.previous ?? undefined).toBeUndefined()
        expect(start.cursor.next).toEqual(expect.any(String))
        const middle = yield* requestJson<Page>(`/api/session/${session.id}/message?limit=1&cursor=${start.cursor.next}`, { headers })
        expect(middle.data.map((message) => message.id)).toEqual(expected.slice(1, 2))
        const end = yield* requestJson<Page>(`/api/session/${session.id}/message?limit=1&cursor=${middle.cursor.next}`, { headers })
        expect(end.data.map((message) => message.id)).toEqual(expected.slice(2))
        expect(end.cursor.next ?? undefined).toBeUndefined()
        expect(end.cursor.previous).toEqual(expect.any(String))
        const back = yield* requestJson<Page>(`/api/session/${session.id}/message?limit=1&cursor=${end.cursor.previous}`, { headers })
        expect(back.data.map((message) => message.id)).toEqual(expected.slice(1, 2))
        expect(back.cursor.previous).toEqual(expect.any(String))
        expect(back.cursor.next).toEqual(expect.any(String))
        const beginning = yield* requestJson<Page>(`/api/session/${session.id}/message?limit=1&cursor=${back.cursor.previous}`, { headers })
        expect(beginning.data.map((message) => message.id)).toEqual(expected.slice(0, 1))
        expect(beginning.cursor.previous ?? undefined).toBeUndefined()
        const full = yield* requestJson<Page>(`/api/session/${session.id}/message?limit=3&order=${order}`, { headers })
        expect(full.data.map((message) => message.id)).toEqual(expected)
        expect(full.cursor.next ?? undefined).toBeUndefined()
        expect(full.cursor.previous ?? undefined).toBeUndefined()
        const invalid = yield* request(`/api/session/${session.id}/message?limit=0&cursor=${end.cursor.previous}`, { headers })
        expect(invalid.status).toBe(400)
      }
    }),
    { git: true, config: { formatter: false, lsp: false, share: "disabled" } },
  )

  it.instance(
    "serves message mutation routes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-hena-directory": test.directory, "content-type": "application/json" }
        const session = yield* createSession({ title: "messages" })
        const first = yield* createTextMessage(session.id, "first")
        const second = yield* createTextMessage(session.id, "second")

        const updated = yield* requestJson<SessionV1.Part>(
          pathFor(SessionPaths.updatePart, {
            sessionID: session.id,
            messageID: first.info.id,
            partID: first.part.id,
          }),
          {
            method: "PATCH",
            headers,
            body: JSON.stringify({ ...first.part, text: "updated" }),
          },
        )
        expect(updated).toMatchObject({ id: first.part.id, type: "text", text: "updated" })

        expect(
          yield* requestJson<boolean>(
            pathFor(SessionPaths.deletePart, {
              sessionID: session.id,
              messageID: first.info.id,
              partID: first.part.id,
            }),
            { method: "DELETE", headers },
          ),
        ).toBe(true)

        expect(
          yield* requestJson<boolean>(
            pathFor(SessionPaths.deleteMessage, { sessionID: session.id, messageID: second.info.id }),
            { method: "DELETE", headers },
          ),
        ).toBe(true)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "rejects part updates whose path and body ids disagree",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-hena-directory": test.directory, "content-type": "application/json" }
        const session = yield* createSession({ title: "part mismatch" })
        const message = yield* createTextMessage(session.id, "first")
        const response = yield* request(
          pathFor(SessionPaths.updatePart, {
            sessionID: session.id,
            messageID: message.info.id,
            partID: message.part.id,
          }),
          {
            method: "PATCH",
            headers,
            body: JSON.stringify({ ...message.part, id: PartID.ascending() }),
          },
        )

        expect(response.status).toBe(400)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "serves remaining non-LLM session mutation routes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-hena-directory": test.directory, "content-type": "application/json" }
        const session = yield* createSession({ title: "remaining" })

        expect(
          yield* requestJson<Session.Info>(pathFor(SessionPaths.revert, { sessionID: session.id }), {
            method: "POST",
            headers,
            body: JSON.stringify({ messageID: MessageID.ascending() }),
          }),
        ).toMatchObject({ id: session.id })

        expect(
          yield* requestJson<Session.Info>(pathFor(SessionPaths.unrevert, { sessionID: session.id }), {
            method: "POST",
            headers,
          }),
        ).toMatchObject({ id: session.id })

        const permissionID = String(PermissionV1.ID.ascending())
        const permission = yield* request(
          pathFor(SessionPaths.permissions, {
            sessionID: session.id,
            permissionID,
          }),
          {
            method: "POST",
            headers,
            body: JSON.stringify({ response: "once" }),
          },
        )
        expect(permission.status).toBe(404)
        expect(yield* responseJson(permission)).toEqual({
          _tag: "PermissionNotFoundError",
          requestID: permissionID,
          message: `Permission request not found: ${permissionID}`,
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
