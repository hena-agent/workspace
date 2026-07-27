import { expect, test } from "bun:test"
import { sessionEpilogue } from "../../src/util/presentation"

test("formats session continuation summary", () => {
  const epilogue = sessionEpilogue({ title: "A session", sessionID: "ses_123" })
  const visible = epilogue.replaceAll(/\x1b\[[0-9;]*m/g, "")
  expect(visible.split("\n").slice(0, 4).map((line) => line.trimEnd())).toEqual([
    "",
    "  █  █ █▀▀ █▄ █ █▀█",
    "  █▀▀█ █▀▀ █ ▀█ █▀█",
    "  ▀  ▀ ▀▀▀ ▀  ▀ ▀ ▀",
  ])
  expect(epilogue).toContain("A session")
  expect(epilogue).toContain("hena -s ses_123")
})
