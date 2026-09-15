import { expect, test } from "@playwright/test"
import { mockHenaServer } from "./utils/mock-server"
import { fixture, pageMessages } from "./performance/timeline/session-timeline-stress.fixture"
import { installTimelineSettings, stressSessionHref } from "./performance/timeline/timeline-test-helpers"

test("live execution failure toasts once, never again from reconnect snapshots", async ({ page }) => {
  let connections = 0
  let snapshots = 0
  const message = "Execution failed for this live drain"
  await mockHenaServer(page, {
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
    events: () => {
      connections++
      return [
        ...(connections === 1
          ? [
              {
                directory: "global",
                payload: {
                  type: "session.next.execution.status",
                  data: { sessionID: fixture.sourceID, status: { type: "failed", error: { message } } },
                },
              },
            ]
          : []),
        { directory: "global", payload: { type: "server.connected", properties: {} } },
      ]
    },
  })
  // An older server may still send terminal snapshots. They must not notify users.
  await page.route("**/api/session/active", async (route) => {
    snapshots++
    await route.fulfill({
      json: {
        data: {
          [fixture.sourceID]: { type: "failed", error: { type: "unknown", message } },
          ses_historical: { type: "failed", error: { type: "unknown", message: "Historical failure" } },
        },
      },
    })
  })
  await installTimelineSettings(page)
  await page.goto(stressSessionHref(fixture.sourceID))
  const notifications = page.locator('[data-component="toast"], [data-component="toast-v2"]')
  await expect(notifications.filter({ hasText: message })).toHaveCount(1)
  await expect.poll(() => snapshots).toBeGreaterThanOrEqual(3)
  await expect(notifications.filter({ hasText: message })).toHaveCount(1)
  await expect(notifications.filter({ hasText: "Historical failure" })).toHaveCount(0)
})
