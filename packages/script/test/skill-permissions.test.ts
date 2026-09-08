import { describe, expect, test } from "bun:test"
import { readdir } from "node:fs/promises"
import path from "path"

const root = path.resolve(import.meta.dir, "../../..")
const skillsDirectory = path.join(root, ".agents/skills")

describe("skill permission consistency", () => {
  test("denies every user-invoked skill in both opencode.jsonc and hena.jsonc", async () => {
    // OpenCode-compatible skills mark themselves "user-invoked only" via
    // disable-model-invocation frontmatter, but neither OpenCode nor Hena
    // reads that field: enforcement lives entirely in each tool's own
    // permission.skill config (opencode.jsonc for OpenCode, .hena/hena.jsonc
    // for Hena). This test keeps the two hand-maintained deny lists from
    // silently drifting out of sync with each other or with the skills
    // themselves.
    const entries = await readdir(skillsDirectory, { withFileTypes: true })
    const userInvokedSkills = (
      await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map(async (entry) => {
            const skillFile = Bun.file(path.join(skillsDirectory, entry.name, "SKILL.md"))
            if (!(await skillFile.exists())) return undefined
            const frontmatter = (await skillFile.text()).match(/^---\n([\s\S]*?)\n---/)?.[1]
            const data = frontmatter ? (Bun.YAML.parse(frontmatter) as Record<string, unknown>) : undefined
            return data?.["disable-model-invocation"] === true ? entry.name : undefined
          }),
      )
    ).filter((name) => name !== undefined)

    // Sanity-check the fixture itself: if this hits zero, the frontmatter
    // check above is silently failing to match anything.
    expect(userInvokedSkills.length).toBeGreaterThan(0)

    const opencodeConfig = Bun.JSONC.parse(await Bun.file(path.join(root, "opencode.jsonc")).text()) as {
      permission?: { skill?: Record<string, string> }
    }
    const henaConfig = Bun.JSONC.parse(await Bun.file(path.join(root, ".hena/hena.jsonc")).text()) as {
      permission?: { skill?: Record<string, string> }
    }

    for (const name of userInvokedSkills) {
      expect(opencodeConfig.permission?.skill?.[name]).toBe("deny")
      expect(henaConfig.permission?.skill?.[name]).toBe("deny")
    }
  })
})
