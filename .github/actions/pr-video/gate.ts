import { appendFile } from "node:fs/promises"
import { gate } from "./result"

const result = gate(await Bun.file(`${process.env.RUNNER_TEMP}/pr-video-result.md`).text())
await appendFile(process.env.GITHUB_OUTPUT!, `record=${result.record}\n`)
await appendFile(
  process.env.GITHUB_STEP_SUMMARY!,
  `### Browser eligibility\n\nRecord: ${result.record}\n\n${result.reason}\n`,
)
