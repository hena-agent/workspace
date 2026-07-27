import { describe, expect, test } from "bun:test"
import { hasExistingAppState } from "./install-state"

const file = (name: string) => ({ name, isDirectory: () => false })
const directory = (name: string) => ({ name, isDirectory: () => true })

describe("hasExistingAppState", () => {
  test("ignores files Electron may create on a fresh install", () => {
    expect(hasExistingAppState([])).toBe(false)
    expect(hasExistingAppState([file("Local State"), directory("Crashpad")])).toBe(false)
  })

  test("recognizes Hena state", () => {
    expect(hasExistingAppState([file("hena.settings")])).toBe(true)
    expect(hasExistingAppState([file("hena.global.dat")])).toBe(true)
    expect(hasExistingAppState([file("window-state-abc.json")])).toBe(true)
    expect(hasExistingAppState([directory("hena")])).toBe(true)
  })
})
