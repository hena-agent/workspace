import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

for (const previous of [false, true]) {
  test(
    previous ? "old bootstrap await leaves the cold session suspended" : "cold desktop session mounts after bootstrap",
    () => {
      const result = Bun.spawnSync({
        cmd: [
          process.execPath,
          "--conditions=browser",
          "--preload",
          "./happydom.ts",
          "--preload",
          "./test-browser/fixtures/desktop-cold-start-preload.ts",
          "./test-browser/fixtures/desktop-cold-start.ts",
        ],
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env: { ...process.env, HENA_TEST_OLD_BOOTSTRAP: previous ? "1" : "0" },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 20_000,
      })
      const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr)
      expect(output).toContain("bootstrap released")
      if (previous) {
        expect(result.exitCode).toBe(1)
        expect(output).toContain("restored session composer must mount")
        expect(output).toContain("history requests: 0")
        return
      }
      expect(output).toContain("history requests: 1")
      expect(output).toContain("cold desktop session mounted")
      expect(result.exitCode).toBe(0)
    },
    30_000,
  )
}
