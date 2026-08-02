import { expect, test, type Page } from "@playwright/test"
import type { ProjectChat } from "@hena/sdk/v2/client"
import { mockHenaServer } from "../utils/mock-server"
import { installSseTransport } from "../utils/sse-transport"

const directory = "/mock/projects/source"
const destination = "/mock/destinations/attached"

test("refetches folderless projects after reconnect when the initial list failed", async ({ page }) => {
  const transport = await installSseTransport(page, {
    server: `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`,
    retry: 20,
  })
  let first = true
  let firstSessions = true
  let lists = 0
  let sessionLists = 0
  const server = await mockServer(page, {
    projectListResponse: () => {
      if (!first) return
      first = false
      return { status: 503, body: { message: "temporarily unavailable" } }
    },
    onProjectList: () => {
      lists += 1
    },
    sessionListResponse: () => {
      if (!firstSessions) return
      firstSessions = false
      return { status: 503, body: { message: "temporarily unavailable" } }
    },
    onSessionList: () => {
      sessionLists += 1
    },
  })

  await page.goto("/")
  await transport.waitForConnection()
  await expect(page.locator('[data-component="home-project-row"]')).toHaveCount(0)
  await expect.poll(() => lists).toBe(1)
  await expect.poll(() => sessionLists).toBe(1)

  server.projects.push(chat("chat_recovered", "Recovered chat"))
  await transport.send({ directory: "global", payload: { type: "server.connected" } })

  await expect.poll(() => lists).toBeGreaterThanOrEqual(2)
  await expect.poll(() => sessionLists).toBeGreaterThanOrEqual(2)
  await expect(page.locator('[data-component="home-project-row"]').filter({ hasText: "Recovered chat" })).toBeVisible()
})

test("supports project list, create, and attach lifecycle", async ({ page }) => {
  let lists = 0
  const created: ProjectChat[] = []
  const attached: string[] = []
  const server = await mockServer(page, {
    onProjectList: () => {
      lists += 1
    },
    onProjectCreate: (project) => created.push(project),
    onProjectAttach: (input) => attached.push(input.folder),
  })

  await page.goto("/")
  await page.locator('[data-action="home-start-chat-row"]').click()
  await page.getByRole("textbox", { name: "What are you working on?" }).fill("Lifecycle chat")
  await page.getByRole("button", { name: "Start chatting" }).click()

  await expect.poll(() => created.length).toBe(1)
  await expect.poll(() => lists).toBeGreaterThanOrEqual(2)
  expect(server.projects.map((project) => project.name)).toEqual(["Lifecycle chat"])

  const result = await page.evaluate(
    async ({ url, projectID, folder }) => {
      const attach = () =>
        fetch(`${url}/api/project/${projectID}/folder`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ folder }),
        }).then((response) => response.json())
      return [await attach(), await attach()]
    },
    {
      url: `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`,
      projectID: created[0]!.id,
      folder: destination,
    },
  )

  expect(result).toEqual([
    expect.objectContaining({ project: { id: "project_attached_chat_1", directory: destination, vcs: "git" } }),
    expect.objectContaining({ project: { id: "project_attached_chat_1", directory: destination, vcs: "git" } }),
  ])
  expect(attached).toEqual([destination])
  expect(server.projects).toEqual([])
})

test("reconciles an attachment from another client and refreshes nested sessions", async ({ page }) => {
  const transport = await installSseTransport(page, {
    server: `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`,
    retry: 20,
  })
  const project = chat("remote", "Remote chat")
  const resolved: string[] = []
  const server = await mockServer(page, {
    projects: [project],
    onSession: (sessionID) => resolved.push(sessionID),
    sessions: [
      {
        id: "session_nested",
        projectID: project.id,
        directory: project.directory,
        path: "packages/app",
        title: "Nested session",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
  })

  await page.goto("/")
  await transport.waitForConnection()
  await expect(page.locator('[data-component="home-project-row"]').filter({ hasText: "Remote chat" })).toBeVisible()

  const attachment = await page.evaluate(
    ({ url, projectID, folder }) =>
      fetch(`${url}/api/project/${projectID}/folder`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folder }),
      }).then((response) => response.json()),
    {
      url: `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`,
      projectID: project.id,
      folder: destination,
    },
  )
  await transport.burst([
    {
      directory: "global",
      payload: {
        id: "event_project_attached",
        type: "project.next.attached",
        properties: { projectID: project.id, attachment, timestamp: Date.now() },
      },
    },
    {
      directory: "global",
      payload: {
        id: "event_session_moved",
        type: "session.next.moved",
        properties: {
          sessionID: "session_nested",
          projectID: attachment.project.id,
          location: { directory: destination },
          subdirectory: "packages/app",
          timestamp: Date.now(),
        },
      },
    },
  ])

  await expect(page.locator('[data-component="home-project-row"]').filter({ hasText: "Remote chat" })).toHaveCount(0)
  await expect.poll(() => resolved).toContain("session_nested")
  expect(server.projects).toEqual([])
  expect(server.project).toEqual(expect.objectContaining({ directory: destination }))
  expect(server.project).not.toEqual(expect.objectContaining({ directory }))
})

test("recovers an attachment missed while disconnected", async ({ page }) => {
  const transport = await installSseTransport(page, {
    server: `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`,
    retry: 20,
  })
  const project = chat("missed", "Missed chat")
  await mockServer(page, { projects: [project] })

  await page.goto("/")
  await transport.waitForConnection()
  await expect(page.locator('[data-component="home-project-row"]').filter({ hasText: "Missed chat" })).toBeVisible()

  await page.evaluate(
    ({ url, projectID, folder }) =>
      fetch(`${url}/api/project/${projectID}/folder`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folder }),
      }),
    {
      url: `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`,
      projectID: project.id,
      folder: destination,
    },
  )
  await transport.send({ directory: "global", payload: { type: "server.connected" } })

  await expect(page.locator('[data-component="home-project-row"]').filter({ hasText: "Missed chat" })).toHaveCount(0)
  await expect(page.locator('[data-component="home-project-row"]')).toHaveCount(1)
})

async function mockServer(page: Page, overrides: Partial<Parameters<typeof mockHenaServer>[1]> = {}) {
  return mockHenaServer(page, {
    directory,
    project: {
      id: "project",
      worktree: directory,
      vcs: "git",
      name: "projects",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    projects: [],
    provider: { all: [], connected: [], default: {} },
    sessions: [],
    pageMessages: () => ({ items: [] }),
    fileList: () => [],
    ...overrides,
  })
}

function chat(id: string, name: string): ProjectChat {
  return {
    id,
    name,
    directory: `hena://project/${id}`,
    time: { created: 1700000000000, updated: 1700000000000 },
  }
}
