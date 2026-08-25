import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://127.0.0.1:4117",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "E2E_PORT=4117 bun ./e2e/server.ts",
      url: "http://127.0.0.1:4117/api/collection/capabilities",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "E2E_PORT=4118 bun ./e2e/server.ts",
      url: "http://127.0.0.1:4118/api/collection/capabilities",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
