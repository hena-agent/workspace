import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Global } from "@hena/core/global"

describe("global paths", () => {
  test("tmp path is under the system temp directory", () => {
    expect(Global.Path.tmp).toBe(path.join(os.tmpdir(), "hena"))
    expect(Global.make().tmp).toBe(Global.Path.tmp)
  })

  test("tmp path is created on module load", async () => {
    expect((await fs.stat(Global.Path.tmp)).isDirectory()).toBe(true)
  })

  test("path overrides do not cascade", () => {
    const data = path.join(os.tmpdir(), "hena-global-override")
    expect(Global.make({ data })).toMatchObject({
      data,
      log: Global.Path.log,
      projects: Global.Path.projects,
      repos: Global.Path.repos,
    })
  })
})
