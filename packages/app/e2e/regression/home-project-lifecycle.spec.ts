import { expect, test, type Page } from "@playwright/test"
import type { ProjectChat } from "@hena/sdk/v2/client"
import { mockHenaServer } from "../utils/mock-server"
import { installSseTransport } from "../utils/sse-transport"

const directory = "C:/Hena/Projects"

test("refetches folderless projects after reconnect when the initial list failed", async ({ page }) => {
  const transport = await installSseTransport(page, {
    server: `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`,
    retry: 20,
  })
  let first = true
  let lists = 0
  const server = await mockServer(page, {
    projectListResponse: () => {
      if (!first) return
      first = false
      return { status: 503, body: { message: "temporarily unavailable" } }
    },
    onProjectList: () => {
      lists += 1
    },
  })

  await page.goto("/")
  await transport.waitForConnection()
  await expect(page.locator('[data-component="home-project-row"]')).toHaveCount(0)

  server.projects.push(chat("chat_recovered", "Recovered chat"))
  await transport.send({ directory: "global", payload: { type: "server.connected" } })

  await expect.poll(() => lists).toBeGreaterThanOrEqual(2)
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
      folder: `${directory}/Attached`,
    },
  )

  expect(result).toEqual([
    expect.objectContaining({ project: { id: "project_attached", directory: `${directory}/Attached`, vcs: "git" } }),
    expect.objectContaining({ project: { id: "project_attached", directory: `${directory}/Attached`, vcs: "git" } }),
  ])
  expect(attached).toEqual([`${directory}/Attached`])
  expect(server.projects).toEqual([])
})

async function mockServer(
  page: Page,
  overrides: Partial<Parameters<typeof mockHenaServer>[1]> = {},
) {
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
