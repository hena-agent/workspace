import { describe, expect, test } from "bun:test"
import packageJson from "../package.json"

describe("Hena branding", () => {
  test("publishes the hena package and binary", () => {
    expect(packageJson.name).toBe("hena")
    expect(packageJson.bin).toEqual({ "hena": "./bin/hena" })
  })
})
