import { expect, test } from "bun:test"

test("renders ModelsProvider children while the managed catalog loads", () => {
  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      "--conditions=browser",
      "--preload",
      "./happydom.ts",
      "test-browser/fixtures/models-provider.ts",
    ],
    stdout: "pipe",
    stderr: "pipe",
  })

  expect(result.exitCode).toBe(0)
  if (result.exitCode !== 0) {
    expect(new TextDecoder().decode(result.stderr)).toBe("")
  }
})
