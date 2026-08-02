import type { Page, Route } from "@playwright/test"
import type { ProjectAttachment, ProjectAttachmentReceipt, ProjectChat } from "@hena/sdk/v2/client"
import type { QuestionAnswer } from "@hena/sdk/v2"
import { posix, win32 } from "node:path"

const emptyList = new Set(["/skill", "/command", "/lsp", "/formatter", "/vcs/status", "/vcs/diff"])
const emptyObject = new Set(["/global/config", "/config", "/provider/auth", "/mcp", "/experimental/resource"])

export interface MockServerConfig {
  provider: unknown
  directory: string
  project: unknown
  projects?: ProjectChat[]
  sessions: ({ id: string } & Record<string, unknown>)[]
  onSessionList?: () => void
  sessionListResponse?: () => { status?: number; body?: unknown } | void
  onSession?: (sessionID: string) => void
  pageMessages: (sessionId: string, limit: number, before?: string) => { items: unknown[]; cursor?: string }
  vcsDiff?: unknown[]
  messageDelay?: number
  beforeMessagesResponse?: (input: { sessionID: string; before?: string }) => Promise<void>
  onMessages?: (input: { sessionID: string; before?: string; phase: "start" | "end" }) => void
  message?: (sessionID: string, messageID: string) => unknown
  onMessage?: (input: { sessionID: string; messageID: string }) => void
  events?: () => unknown[]
  eventRetry?: number
  todos?: (sessionID: string) => unknown[]
  permissions?: unknown[] | (() => unknown[])
  questions?: unknown[] | (() => unknown[])
  currentQuestions?: unknown[] | (() => unknown[])
  onProjectList?: (projects: ProjectChat[]) => void
  projectListResponse?: (
    projects: ProjectChat[],
  ) => { status?: number; body?: unknown } | void | Promise<{ status?: number; body?: unknown } | void>
  onProjectCreate?: (project: ProjectChat) => void
  projectAttachment?: (input: { projectID: string; folder: string; sessionIDs: string[] }) => ProjectAttachment
  onProjectAttach?: (input: { projectID: string; folder: string; attachment: ProjectAttachment }) => void
  questionReply?: (input: {
    requestID: string
    directory?: string
    answers: QuestionAnswer[]
    attempt: number
  }) => { status?: number; body?: unknown } | void
  fileList?: (path: string) => unknown | Promise<unknown>
  fileContent?: (path: string) => unknown | Promise<unknown>
  findFiles?: (input: { query: string; dirs?: string; limit?: number }) => unknown
  sessionStatus?: unknown
}

export async function mockHenaServer(page: Page, config: MockServerConfig) {
  const cursors = new Map<string, string>()
  const projects = [...(config.projects ?? [])]
  const attachments = new Map<string, { folder: string; attachment: ProjectAttachment }>()
  const questionReplyAttempts = new Map<string, number>()
  let currentProject = config.project
  let nextCursor = 0
  const staticRoutes: Record<string, unknown> = {
    "/provider": config.provider,
    "/path": {
      state: config.directory,
      config: config.directory,
      worktree: config.directory,
      directory: config.directory,
      home: "C:/Hena",
    },
    "/agent": [{ name: "build", mode: "primary" }],
    "/vcs": { branch: "main", default_branch: "main" },
    "/session": config.sessions,
  }

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    const targetPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
    const appPort = new URL(
      process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3000"}`,
    ).port
    if (url.port !== targetPort && url.port !== appPort) return route.fallback()

    const path = url.pathname
    if (path === "/global/event" || path === "/event") return sse(route, config.events?.(), config.eventRetry)
    if (path === "/global/health") return json(route, { healthy: true })
    if (path === "/api/session") {
      config.onSessionList?.()
      const result = config.sessionListResponse?.()
      if (result) return json(route, result.body, undefined, result.status ?? 200)
      return json(route, {
        data: config.sessions.map((session) => v2Session(session, config.directory)),
        cursor: {},
      })
    }
    if (path === "/api/project" && route.request().method() === "GET") {
      config.onProjectList?.([...projects])
      const result = await config.projectListResponse?.([...projects])
      return json(route, result?.body ?? projects, undefined, result?.status ?? 200)
    }
    if (path === "/api/project/attachment" && route.request().method() === "GET") {
      return json(
        route,
        [...attachments].map(
          ([projectID, receipt]): ProjectAttachmentReceipt => ({ projectID, attachment: receipt.attachment }),
        ),
      )
    }
    if (path === "/api/project" && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { name: string }
      const id = `chat_${projects.length + 1}`
      const project: ProjectChat = {
        id,
        name: body.name,
        directory: `hena://project/${id}`,
        time: { created: Date.now(), updated: Date.now() },
      }
      projects.unshift(project)
      config.onProjectCreate?.(project)
      return json(route, project)
    }
    const projectFolderMatch = path.match(/^\/api\/project\/([^/]+)\/folder$/)
    if (projectFolderMatch && route.request().method() === "PUT") {
      const projectID = decodeURIComponent(projectFolderMatch[1]!)
      const body = route.request().postDataJSON() as { folder: string }
      const index = projects.findIndex((project) => project.id === projectID)
      if (index === -1) {
        const receipt = attachments.get(projectID)
        if (receipt?.folder === body.folder) return json(route, receipt.attachment)
        return json(route, { message: "Project not found" }, undefined, 404)
      }
      const source = projects[index]
      if (!source) return json(route, { message: "Project not found" }, undefined, 404)
      projects.splice(index, 1)
      const sessionIDs = config.sessions
        .filter((session) => session.projectID === projectID)
        .map((session) => session.id)
      const attachment = config.projectAttachment?.({ projectID, folder: body.folder, sessionIDs }) ?? {
        project: { id: `project_attached_${projectID}`, directory: body.folder, vcs: "git" as const },
        sessionIDs,
      }
      config.sessions.forEach((session) => {
        if (session.projectID !== projectID) return
        const paths = /^[A-Za-z]:[\\/]/.test(attachment.project.directory) ? win32 : posix
        const relative = paths.relative(source.directory, String(session.directory ?? source.directory))
        const candidate = typeof session.path === "string" ? session.path : relative
        const subpath =
          candidate === ".." || candidate.startsWith(`..${paths.sep}`) || paths.isAbsolute(candidate) ? "" : candidate
        session.projectID = attachment.project.id
        session.directory = paths.resolve(attachment.project.directory, subpath)
        session.path = subpath || undefined
      })
      currentProject = {
        ...(typeof currentProject === "object" && currentProject !== null ? currentProject : {}),
        ...attachment.project,
        worktree: attachment.project.directory,
      }
      attachments.set(projectID, { folder: body.folder, attachment })
      config.onProjectAttach?.({ projectID, folder: body.folder, attachment })
      return json(route, attachment)
    }
    if (path === "/experimental/capabilities") return json(route, { backgroundSubagents: false })
    if (path === "/permission")
      return json(route, typeof config.permissions === "function" ? config.permissions() : (config.permissions ?? []))
    if (path === "/question")
      return json(route, typeof config.questions === "function" ? config.questions() : (config.questions ?? []))
    if (path === "/api/question/request")
      return json(route, {
        location: {
          directory: config.directory,
          project: { id: (currentProject as { id?: string }).id, directory: config.directory },
        },
        data:
          typeof config.currentQuestions === "function" ? config.currentQuestions() : (config.currentQuestions ?? []),
      })
    const questionReplyMatch = path.match(/^\/question\/([^/]+)\/reply$/)
    if (questionReplyMatch && route.request().method() === "POST" && config.questionReply) {
      const requestID = decodeURIComponent(questionReplyMatch[1]!)
      const attempt = (questionReplyAttempts.get(requestID) ?? 0) + 1
      questionReplyAttempts.set(requestID, attempt)
      const result = config.questionReply({
        requestID,
        directory: requestDirectory(route, url),
        answers: (route.request().postDataJSON() as { answers: QuestionAnswer[] }).answers,
        attempt,
      })
      return json(route, result?.body ?? true, undefined, result?.status ?? 200)
    }
    const currentQuestionReplyMatch = path.match(/^\/api\/session\/([^/]+)\/question\/([^/]+)\/reply$/)
    if (currentQuestionReplyMatch && route.request().method() === "POST" && config.questionReply) {
      const requestID = decodeURIComponent(currentQuestionReplyMatch[2]!)
      const attempt = (questionReplyAttempts.get(requestID) ?? 0) + 1
      questionReplyAttempts.set(requestID, attempt)
      const result = config.questionReply({
        requestID,
        directory: requestDirectory(route, url),
        answers: (route.request().postDataJSON() as { answers: QuestionAnswer[] }).answers,
        attempt,
      })
      return route.fulfill({ status: result?.status ?? 204 })
    }
    if (path === "/session/status") return json(route, config.sessionStatus ?? {})
    if (path === "/vcs/diff" && config.vcsDiff) return json(route, config.vcsDiff)
    if (path === "/file" && config.fileList)
      return json(route, await config.fileList(url.searchParams.get("path") ?? ""))
    if (path === "/file/content" && config.fileContent)
      return json(route, await config.fileContent(url.searchParams.get("path") ?? ""))
    if (path === "/find/file" && config.findFiles)
      return json(
        route,
        await config.findFiles({
          query: url.searchParams.get("query") ?? "",
          dirs: url.searchParams.get("dirs") ?? undefined,
          limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined,
        }),
      )
    if (path === "/api/reference")
      return json(route, {
        location: {
          directory: config.directory,
          project: { id: (currentProject as { id?: string }).id, directory: config.directory },
        },
        data: [],
      })
    if (path === "/project") return json(route, [currentProject])
    if (path === "/project/current") return json(route, currentProject)
    if (emptyObject.has(path)) return json(route, {})
    if (emptyList.has(path)) return json(route, [])
    if (path in staticRoutes) return json(route, staticRoutes[path])

    const sessionMatch = path.match(/^\/session\/([^/]+)$/)
    if (sessionMatch) {
      config.onSession?.(sessionMatch[1]!)
      const session = config.sessions.find((s) => s.id === sessionMatch[1])
      return json(route, session ?? {})
    }

    const projectMatch = path.match(/^\/project\/([^/]+)$/)
    if (projectMatch) return json(route, currentProject)

    const messageMatch = path.match(/^\/session\/([^/]+)\/message\/([^/]+)$/)
    if (messageMatch) {
      config.onMessage?.({ sessionID: messageMatch[1]!, messageID: messageMatch[2]! })
      if (config.messageDelay !== undefined) await new Promise((resolve) => setTimeout(resolve, config.messageDelay))
      const message = config.message?.(messageMatch[1]!, messageMatch[2]!)
      if (message === undefined) return json(route, { error: "Message not found" }, undefined, 404)
      return json(route, message)
    }

    const todoMatch = path.match(/^\/session\/([^/]+)\/todo$/)
    if (todoMatch) return json(route, config.todos?.(todoMatch[1]!) ?? [])
    if (/^\/session\/[^/]+\/(children|diff)$/.test(path)) return json(route, [])

    const messagesMatch = path.match(/^\/session\/([^/]+)\/message$/)
    if (messagesMatch) {
      const token = url.searchParams.get("before") ?? undefined
      const before = token ? cursors.get(token) : undefined
      if (token && !before) return json(route, { error: "Invalid cursor" }, undefined, 400)
      config.onMessages?.({ sessionID: messagesMatch[1], before, phase: "start" })
      await config.beforeMessagesResponse?.({ sessionID: messagesMatch[1]!, before })
      if (config.messageDelay !== undefined) await new Promise((resolve) => setTimeout(resolve, config.messageDelay))
      const limit = Number(url.searchParams.get("limit") ?? 80)
      const pageData = config.pageMessages(messagesMatch[1], limit, before)
      config.onMessages?.({ sessionID: messagesMatch[1], before, phase: "end" })
      if (!pageData.cursor) return json(route, pageData.items)
      const cursor = `cursor_${++nextCursor}`
      cursors.set(cursor, pageData.cursor)
      return json(route, pageData.items, { "x-next-cursor": cursor })
    }

    if (url.port === targetPort && targetPort !== appPort) return json(route, {})
    return route.fallback()
  })

  return {
    projects,
    get project() {
      return currentProject
    },
    setProject(project: unknown) {
      currentProject = project
    },
  }
}

function v2Session(session: { id: string } & Record<string, unknown>, fallbackDirectory: string) {
  const time = session.time && typeof session.time === "object" ? session.time : {}
  return {
    id: session.id,
    parentID: session.parentID,
    projectID: session.projectID ?? "project",
    cost: session.cost ?? 0,
    tokens: session.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: {
      created: "created" in time && typeof time.created === "number" ? time.created : 0,
      updated: "updated" in time && typeof time.updated === "number" ? time.updated : 0,
      ...(session.time && typeof session.time === "object" && "archived" in session.time
        ? { archived: session.time.archived }
        : {}),
    },
    title: session.title ?? session.id,
    location: {
      directory: typeof session.directory === "string" ? session.directory : fallbackDirectory,
      ...(typeof session.workspaceID === "string" ? { workspaceID: session.workspaceID } : {}),
    },
    ...(typeof session.path === "string" ? { subpath: session.path } : {}),
  }
}

function json(route: Route, body: unknown, headers?: Record<string, string>, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "x-next-cursor",
      ...headers,
    },
    body: JSON.stringify(body ?? null),
  })
}

function requestDirectory(route: Route, url: URL) {
  const value = url.searchParams.get("directory") ?? route.request().headers()["x-hena-directory"]
  return value ? decodeURIComponent(value) : undefined
}

function sse(route: Route, events?: unknown[], retry?: number) {
  return route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body: `${retry === undefined ? "" : `retry: ${retry}\n\n`}${events?.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") || ": ok\n\n"}`,
  })
}
