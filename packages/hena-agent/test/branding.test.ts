import { describe, expect, test } from "bun:test"
import packageJson from "../package.json"

describe("Hena Agent branding", () => {
  test("publishes the hena-agent package and binary", () => {
    expect(packageJson.name).toBe("hena-agent")
    expect(packageJson.bin).toEqual({ "hena-agent": "./bin/hena-agent" })
  })
})
