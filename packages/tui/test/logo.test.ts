import { expect, test } from "bun:test"
import { logo } from "../src/logo"

test("uses the Hena wordmark", () => {
  expect(logo).toEqual(["                  ", "█  █ █▀▀ █▄ █ █▀█", "█▀▀█ █▀▀ █ ▀█ █▀█", "▀  ▀ ▀▀▀ ▀  ▀ ▀ ▀"])
})
