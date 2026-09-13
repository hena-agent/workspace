import { expect, test } from "bun:test"
import { mkdtemp, rm, symlink, truncate } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { gate, prepare } from "../../../.github/actions/pr-video/result"

test("only an explicit gate verdict admits browser recording", () => {
  expect(gate("RECORD: yes\nSidebar navigation changed.")).toEqual({
    record: true,
    reason: "Sidebar navigation changed.",
  })
  expect(gate("RECORD: no\nBackend-only change.").record).toBe(false)
  expect(gate("Probably RECORD: yes").record).toBe(false)
  expect(gate("```\nRECORD: yes\n```").record).toBe(false)
  expect(gate("").record).toBe(false)
  expect(gate("RECORD: yes\nVisible change.\nExtra output.")).toEqual({
    record: false,
    reason: "No valid browser eligibility verdict was returned.",
  })
})

test("publishing preserves the complete accepted response, including its final coverage notes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pr-video-"))
  try {
    const text = "Observed behavior. ".repeat(1400) + "\n\nUnrecorded: provider-dependent error path."
    const result = await prepare(directory, text)
    expect(result.body).toBe(text)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("only the recorder receives browser commands and its source reads exclude the live app", async () => {
  const script = await Bun.file(path.resolve(import.meta.dir, "../../../.github/actions/pr-video/run.sh")).text()
  const filter = script.match(/OPENCODE_PERMISSION=\$\(jq -cn[^\n]*'([\s\S]*?)'\)/)?.[1]
  expect(filter).toBeDefined()
  for (const command of ["pr-video-gate", "pr-video"]) {
    const result = Bun.spawnSync(["jq", "-cn", "--arg", "pr", "42", "--arg", "command", command, filter!])
    expect(result.exitCode).toBe(0)
    const permission = JSON.parse(result.stdout.toString())
    expect(permission.bash["*"]).toBe("deny")
    expect(permission.bash["gh pr diff 42"]).toBe("allow")
    expect(permission.task).toBe("deny")
    expect(permission.edit).toBe("deny")
    expect(permission.bash["agent-browser *"]).toBe(command === "pr-video" ? "allow" : undefined)
    expect(permission.read?.["*tmp/pr-video-target/*"]).toBe(command === "pr-video" ? "deny" : undefined)
  }
})

test.skipIf(!Bun.which("ffmpeg") || !Bun.which("ffprobe"))(
  "publishing keeps valid short 60fps clips and explains oversized and missing recordings",
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "pr-video-"))
    try {
      const clip = Bun.spawnSync([
        "ffmpeg",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=64x64:r=60",
        "-t",
        "0.1",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        path.join(directory, "01-sidebar.mp4"),
      ])
      expect(clip.exitCode).toBe(0)
      await Bun.write(path.join(directory, "02-large.mp4"), "x")
      await truncate(path.join(directory, "02-large.mp4"), 10_000_000)
      await symlink(path.join(directory, "01-sidebar.mp4"), path.join(directory, "03-link.mp4"))
      const result = await prepare(
        directory,
        "Sidebar works.\n\n![](tmp/pr-video/02-large.mp4)\n\n![](tmp/pr-video/04-missing.mp4)",
      )
      expect(result.clips).toEqual(["tmp/pr-video/01-sidebar.mp4"])
      expect(result.body).toContain("![](tmp/pr-video/01-sidebar.mp4)")
      expect(result.body).not.toContain("![](tmp/pr-video/02-large.mp4)")
      expect(result.body).not.toContain("![](tmp/pr-video/04-missing.mp4)")
      expect(result.body).toContain("10000000 bytes")
      expect(result.body).toContain("04-missing.mp4")
      expect(result.body).toContain("not a regular file")
      const dangling = await prepare(directory, "![](tmp/pr-video/missing.mp4)")
      expect(dangling.body).toContain("A video reference was removed")
      expect(dangling.body).not.toContain("![](tmp/pr-video/missing.mp4)")
      expect(dangling.body).not.toContain("No browser-verifiable path could be recorded")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)

test.skipIf(!Bun.which("ffmpeg") || !Bun.which("ffprobe"))(
  "publishing rejects wrong frame rates and overlong takes",
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "pr-video-"))
    try {
      for (const [name, rate, duration] of [
        ["01-slow", "30", "0.1"],
        ["02-long", "60", "21"],
      ]) {
        expect(
          Bun.spawnSync([
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            `color=c=blue:s=64x64:r=${rate}`,
            "-t",
            duration,
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            path.join(directory, `${name}.mp4`),
          ]).exitCode,
        ).toBe(0)
      }
      const result = await prepare(directory, "")
      expect(result.clips).toEqual([])
      expect(result.body).toContain("requires H.264 at 60 fps")
      expect(result.body).toContain("requires duration of at most 20 seconds")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)

test("video model configurations resolve defaults, overrides, and off without a publishing App", async () => {
  const root = path.resolve(import.meta.dir, "../../..")
  const workflow = Bun.YAML.parse(await Bun.file(path.join(root, ".github/workflows/_review-model.yml")).text()) as {
    jobs: { resolve: { steps: { name: string; run: string }[] } }
  }
  const script = workflow.jobs.resolve.steps.find((step) => step.name === "Resolve model configuration")!.run
  const directory = await mkdtemp(path.join(tmpdir(), "pr-video-model-"))
  try {
    for (const [configuration, override, expected] of [
      ["video", "", "anthropic/claude-sonnet-5"],
      ["video-gate", "", "opencode/muse-spark-1.3-contributor-free"],
      ["video", "openai/gpt-5.6-sol@high", "openai/gpt-5.6-sol"],
      ["video", "off", ""],
      ["video-gate", "openai/gpt-5.6-sol@high", "openai/gpt-5.6-sol"],
      ["video-gate", "off", ""],
    ]) {
      const output = path.join(directory, "output")
      await Bun.write(output, "")
      const result = Bun.spawnSync(["bash", "-c", script], {
        env: {
          ...process.env,
          CONFIGURATION: configuration,
          RAW_REVIEW_MODELS: "",
          RAW_BRIEF_MODEL: "",
          RAW_SCAN_MODEL: "",
          RAW_RESOLVE_MODEL: "",
          RAW_VIDEO_MODEL: configuration === "video" ? override : "",
          RAW_VIDEO_GATE_MODEL: configuration === "video-gate" ? override : "",
          RAW_OPENCODE_VERSION: "",
          VARS_JSON: "{}",
          REPOSITORY: "hena-agent/hena",
          HEAD_REPOSITORY: "hena-agent/hena",
          PULL_REQUEST: "42",
          PR_AUTHOR: "developer",
          GITHUB_OUTPUT: output,
          GITHUB_STEP_SUMMARY: path.join(directory, "summary"),
        },
      })
      expect(result.exitCode).toBe(0)
      const values = await Bun.file(output).text()
      expect(values).toContain(expected ? `model=${expected}\n` : "enabled=false\n")
      if (configuration === "video-gate" && !override) expect(values).toContain("variant=xhigh\n")
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
