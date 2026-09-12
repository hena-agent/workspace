import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

test("prompt submit suite runs with isolated module mocks", () => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", "--only-failures", "--preload", "./happydom.ts", "./src/components/prompt-input/submit.fixture.ts"],
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    stdout: "pipe",
    stderr: "pipe",
  })
  expect(result.exitCode, new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr)).toBe(0)
})
