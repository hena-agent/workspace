import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import stripAnsi from "strip-ansi"

import { formatAccountLabel, formatOrgLine } from "../../src/cli/cmd/account"
import { cliIt } from "../lib/cli-process"

cliIt.live("requires a server URL when logging in", ({ hena }) =>
  Effect.gen(function* () {
    const result = yield* hena.spawn(["console", "login"])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain("url  server URL")
    expect(result.stderr).toContain("[required]")
  }),
)

describe("console account display", () => {
  test("includes the account url in account labels", () => {
    expect(stripAnsi(formatAccountLabel({ email: "one@example.com", url: "https://one.example.com" }, false))).toBe(
      "one@example.com https://one.example.com",
    )
  })

  test("includes the active marker in account labels", () => {
    expect(stripAnsi(formatAccountLabel({ email: "one@example.com", url: "https://one.example.com" }, true))).toBe(
      "one@example.com https://one.example.com (active)",
    )
  })

  test("includes the account url in org rows", () => {
    expect(
      stripAnsi(
        formatOrgLine({ email: "one@example.com", url: "https://one.example.com" }, { id: "org-1", name: "One" }, true),
      ),
    ).toBe("  ● One  one@example.com  https://one.example.com  org-1")
  })
})
