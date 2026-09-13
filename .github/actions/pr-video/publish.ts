import { lstat, appendFile } from "node:fs/promises"
import { prepare } from "./result"

// All provenance comes from the webhook, never from the downloaded artifact.
const event = await Bun.file(process.env.GITHUB_EVENT_PATH!).json()
const repo = process.env.GITHUB_REPOSITORY!
const pr = String(event.pull_request.number)
if (!process.env.GH_TOKEN)
  throw new Error(
    "Set PR_VIDEO_TOKEN to an OAuth/PAT credential with repository write access; GitHub App tokens cannot upload attachments.",
  )
if (!/^[1-9][0-9]*$/.test(pr)) throw new Error("Invalid PR number")
const current = Bun.spawnSync(["gh", "api", `repos/${repo}/pulls/${pr}`], { timeout: 30_000 })
if (current.exitCode !== 0) throw new Error(current.stderr.toString() || "GitHub PR lookup failed or timed out.")
const latest = JSON.parse(current.stdout.toString())
if (latest.head.sha !== event.pull_request.head.sha || latest.base.sha !== event.pull_request.base.sha) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY!, "Skipping stale recordings: the PR head or base changed.\n")
  process.exit(0)
}

const response = await lstat("tmp/pr-video/result.md")
if (!response.isFile() || response.size > 32_000) throw new Error("Invalid recorder response")
const result = await prepare("tmp/pr-video", await Bun.file("tmp/pr-video/result.md").text())
if (!result.clips.length && event.action !== "labeled") {
  await appendFile(process.env.GITHUB_STEP_SUMMARY!, `${result.body}\n`)
  process.exit(0)
}
const url = `${process.env.GITHUB_SERVER_URL}/${repo}`
const body =
  `### PR videos · [\`${event.pull_request.head.sha.slice(0, 9)}\`](${url}/commit/${event.pull_request.head.sha})\n\n` +
  `${result.body}\n\nRecorded with \`${process.env.MODEL}\` · [Workflow run](${url}/actions/runs/${process.env.GITHUB_RUN_ID})`
const posted = Bun.spawnSync(
  [
    "gh",
    "pr",
    "comment",
    pr,
    "--repo",
    repo,
    "--body-file",
    "-",
    ...result.clips.flatMap((clip) => ["--attach", clip]),
  ],
  { stdin: Buffer.from(body), stdout: "inherit", stderr: "inherit", timeout: 180_000 },
)
if (posted.exitCode !== 0) throw new Error("Video upload failed; recordings remain in the workflow artifact.")
