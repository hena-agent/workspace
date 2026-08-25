import { expect, test, type APIRequestContext } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

test.describe.configure({ mode: "serial" })

const server = "http://127.0.0.1:4117"
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const queuedSessionID = id("ses")
const localAuth = await readFile(path.join(homedir(), ".local/share/opencode/auth.json"), "utf8")
  .then((value) => Boolean((JSON.parse(value) as Record<string, unknown>)["opencode-go"]))
  .catch(() => false)
const hasModelCredentials = Boolean(process.env.OPENCODE_GO_AUTH_JSON) || localAuth
let projectRoute = ""
let modelAvailable = hasModelCredentials

test.beforeAll(async ({ request }) => {
  await createSession(request, queuedSessionID, "E2E queued first", "queue")
  const response = await request.post(`${server}/api/session/${queuedSessionID}/interrupt`)
  expect(response.ok()).toBe(true)
})

test("discovers the seeded project and switches between real servers", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Recent projects" })).toBeVisible()
  await page.getByRole("button", { name: new RegExp(escapeRegExp(directory)) }).click()
  projectRoute = page.url().replace(/\/$/, "")

  await page.getByRole("button", { name: /Manage servers/ }).click()
  await page.getByLabel("Add a server").fill("http://127.0.0.1:4118")
  await page.getByRole("button", { name: "Add server" }).click()
  await expect(page).toHaveURL(/\/aHR0cDovLzEyNy4wLjAuMTo0MTE4/)

  await page.getByRole("button", { name: /Manage servers/ }).click()
  await page.getByText("http://127.0.0.1:4117").locator("..").locator("..").click()
  await expect(page).toHaveURL(/\/aHR0cDovLzEyNy4wLjAuMTo0MTE3/)
})

test("saves defaults and creates a queued session through the UI", async ({ page }) => {
  const connectionRoute = new URL(projectRoute).pathname.split("/")[1]
  await page.goto(`/${connectionRoute}/settings/defaults`)
  await page.getByRole("combobox", { name: "Prompt delivery" }).click()
  const saved = page.waitForResponse((response) => response.url().includes("/api/settings/") && response.url().endsWith("/queueDelivery"))
  await page.getByRole("option", { name: "Queue" }).click()
  expect((await saved).ok()).toBe(true)
  await expect(page.getByText("Saved", { exact: true })).toBeVisible()

  await page.goto(projectRoute)
  await page.getByRole("main").getByRole("button", { name: "New session", exact: true }).click()
  await page.getByRole("textbox", { name: "Message" }).fill("E2E queued from UI")
  const created = page.waitForResponse((response) => response.url().endsWith("/api/session") && response.request().method() === "POST")
  await page.getByRole("button", { name: "Send message" }).click()
  const response = await created
  expect(response.ok()).toBe(true)
  expect(response.request().postDataJSON()).toMatchObject({ delivery: "queue" })
  await expect(page).toHaveURL(/\/session\/ses_/)
  await expect(page.getByText("E2E queued from UI", { exact: true })).toBeVisible()
})

test("streams a real model response to completion", async ({ page, request }) => {
  test.skip(!hasModelCredentials, "opencode-go credentials are unavailable")
  test.setTimeout(90_000)
  const sessionID = id("ses")
  await createSession(request, sessionID, "Reply with exactly: pong", "steer", {
    providerID: "opencode-go",
    id: "ox-alpha-free",
  })
  await page.goto(`${projectRoute}/session/${sessionID}`)
  const pong = page.getByText(/^pong$/i)
  const completed = await pong.waitFor({ state: "visible", timeout: 60_000 }).then(() => true).catch(() => false)
  if (!completed) {
    modelAvailable = false
    await page.request.post(`${server}/api/session/${sessionID}/interrupt`)
    test.skip(true, "opencode-go credentials resolved, but the provider did not produce a response within 60 seconds")
  }
  await expect(pong).toBeVisible()
})

test("reorders and cancels queued inputs through authoritative mutations", async ({ page }) => {
  test.skip(!modelAvailable, "opencode-go is unavailable for an active queue")
  const sessionID = id("ses")
  await createSession(page.request, sessionID, "Use the bash tool to run `sleep 30`, then reply done.", "steer", {
    providerID: "opencode-go",
    id: "ox-alpha-free",
  })
  await page.goto(`${projectRoute}/session/${sessionID}`)
  await expect(page.getByText("Thinking...")).toBeVisible()
  const composer = page.getByRole("textbox", { name: "Message" })
  await composer.fill("E2E queued first")
  const firstAdmission = page.waitForResponse((response) => response.url().endsWith(`/session/${sessionID}/prompt`))
  await composer.press("Control+Shift+Enter")
  expect((await firstAdmission).ok()).toBe(true)
  const queue = page.getByLabel("Queued messages")
  await expect(queue).toContainText("E2E queued first")
  await composer.fill("E2E queued second")
  const secondAdmission = page.waitForResponse((response) => response.url().endsWith(`/session/${sessionID}/prompt`))
  await composer.press("Control+Shift+Enter")
  expect((await secondAdmission).ok()).toBe(true)
  await expect(queue).toContainText("E2E queued second")
  await page.waitForTimeout(250)

  const first = queue.getByText("E2E queued first").locator("..")
  const reordered = page.waitForResponse((response) => response.url().endsWith(`/session/${sessionID}/input-order`))
  await first.getByRole("button", { name: "Down" }).click()
  expect((await reordered).ok()).toBe(true)
  await expect(queue.locator(":scope > div").nth(1)).toContainText("E2E queued second")
  await page.waitForTimeout(100)
  const canceled = page.waitForResponse((response) => response.url().includes(`/session/${sessionID}/input/`) && response.url().endsWith("/cancel"))
  await first.getByRole("button", { name: "Cancel" }).click()
  expect((await canceled).ok()).toBe(true)
  await expect(queue).not.toContainText("E2E queued first")
  await page.request.post(`${server}/api/session/${sessionID}/interrupt`)
})

test("reads real files and renders phase-two empty states", async ({ page }) => {
  await page.goto(`${projectRoute}/session/${queuedSessionID}/files`)
  const found = page.waitForResponse((response) => response.url().includes("/api/fs/find"))
  await page.getByRole("textbox", { name: "Find in project" }).fill("package.json")
  expect((await found).ok()).toBe(true)
  await page.getByRole("button", { name: "package.json", exact: true }).click()
  await expect(page.getByText('"name": "hena"')).toBeVisible()

  await page.goto(`${projectRoute}/session/${queuedSessionID}/review`)
  await expect(page.getByText("Review is not supported by this server yet.")).toBeVisible()

  const connectionRoute = new URL(projectRoute).pathname.split("/")[1]
  await page.goto(`/${connectionRoute}/settings/mcp`)
  await expect(page.getByText("MCP servers are not supported by this server yet.")).toBeVisible()
})

async function createSession(
  request: APIRequestContext,
  sessionID: string,
  text: string,
  delivery: "steer" | "queue",
  model?: { providerID: string; id: string },
) {
  const response = await request.post(`${server}/api/session`, {
    data: {
      idempotencyKey: crypto.randomUUID(),
      sessionID,
      messageID: id("msg"),
      location: { directory },
      prompt: { text },
      delivery,
      model,
    },
  })
  expect(response.ok()).toBe(true)
}

function id(prefix: "ses" | "msg") {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
