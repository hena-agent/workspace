import { describe, expect, test } from "bun:test"
import path from "path"

const root = path.resolve(import.meta.dir, "../../..")
const actionDirectory = path.join(root, ".github/actions/run-opencode")
const extractionFilter = path.join(actionDirectory, "extract-review.jq")
const payloadFilter = path.join(actionDirectory, "review-payload.jq")

describe("run-opencode review action", () => {
  test("uses the committed jq filters", async () => {
    const action = await Bun.file(path.join(actionDirectory, "action.yml")).text()
    expect(action).toContain('-f "$GITHUB_ACTION_PATH/extract-review.jq"')
    expect(action).toContain('-f "$GITHUB_ACTION_PATH/review-payload.jq"')
  })

  test("extracts the final text event", () => {
    const result = jq(
      ["-jrs", "--arg", "operation", "final-text", "-f", extractionFilter],
      events({ type: "text", part: { text: "draft" } }, { type: "text", part: { text: "final review" } }),
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe("final review")
  })

  test("rejects a successful command without final text", () => {
    const result = jq(["-jrs", "--arg", "operation", "final-text", "-f", extractionFilter], events())
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain("OpenCode command returned no final text")
  })

  test("extracts the OpenCode task envelope and preserves nested result markers", () => {
    const body = "First\n<task_result>\ninner\n</task_result>\nLast"
    const result = jq(
      ["-jers", "--arg", "operation", "completed-review", "-f", extractionFilter],
      events(
        {
          type: "tool_use",
          part: {
            tool: "task",
            state: {
              status: "completed",
              input: { command: "review" },
              output: `<task id="ses_review" state="completed">\n<task_result>\n${body}\n</task_result>\n</task>`,
            },
          },
        },
        {
          type: "tool_use",
          part: {
            tool: "task",
            state: {
              status: "completed",
              input: { command: "explore" },
              output: '<task id="ses_explore" state="completed">\n<task_result>\nunrelated\n</task_result>\n</task>',
            },
          },
        },
        { type: "error", error: { data: { isRetryable: true } } },
      ),
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe(body)
  })

  test("rejects incomplete tasks, malformed wrappers, and non-retryable errors", () => {
    const failures = [
      events(
        { type: "tool_use", part: { tool: "task", state: { status: "error", output: "" } } },
        { type: "error", error: { data: { isRetryable: true } } },
      ),
      events(
        { type: "tool_use", part: { tool: "task", state: { status: "completed", output: "review" } } },
        { type: "error", error: { data: { isRetryable: true } } },
      ),
      events(
        {
          type: "tool_use",
          part: { tool: "task", state: { status: "completed", output: "<task_result>\nreview\n</task_result>" } },
        },
        { type: "error", error: { data: { isRetryable: true } } },
      ),
      events(
        {
          type: "tool_use",
          part: {
            tool: "task",
            state: {
              status: "completed",
              output: '<task id="ses_review" state="completed">\n<task_result>\nreview\n</task_result>\n</task>',
            },
          },
        },
        { type: "error", error: { data: { isRetryable: false } } },
      ),
    ]
    expect(
      failures.map(
        (input) => jq(["-jers", "--arg", "operation", "completed-review", "-f", extractionFilter], input).exitCode,
      ),
    ).toEqual([5, 5, 5, 5])
  })

  test("renders trusted review provenance", () => {
    const head = "aee25457a1ad5fb898fba2a73333d57427b41607"
    const runUrl = "https://github.com/hena-agent/workspace/actions/runs/32752817218"
    const result = jq(
      [
        "-n",
        "--arg",
        "head",
        head,
        "--arg",
        "model",
        "openai/gpt-5.6-sol",
        "--arg",
        "variant",
        "high",
        "--arg",
        "opencode_version",
        "1.18.22",
        "--arg",
        "run_url",
        runUrl,
        "--arg",
        "commit_url",
        `https://github.com/hena-agent/workspace/commit/${head}`,
        "--rawfile",
        "review",
        "/dev/stdin",
        "-f",
        payloadFilter,
      ],
      "No actionable issues.\n",
    )
    expect(result.exitCode).toBe(0)
    const payload = JSON.parse(result.stdout)
    expect(payload.event).toBe("COMMENT")
    expect(payload.commit_id).toBe(head)
    expect(payload.body).toContain("### Review from `openai/gpt-5.6-sol` (`high`)")
    expect(payload.body).toContain(`[workflow run](${runUrl})`)
    expect(payload.body).toContain(`[commit \`aee25457a\`](https://github.com/hena-agent/workspace/commit/${head})`)
    expect(payload.body).toEndWith("No actionable issues.\n")
    expect(JSON.parse(payload.body.match(/^<!-- ai-review (.+) -->$/m)?.[1] ?? "")).toEqual({
      model: "openai/gpt-5.6-sol",
      variant: "high",
      opencode_version: "1.18.22",
      run_url: runUrl,
      commit: head,
    })
  })
})

function events(...values: unknown[]) {
  return values.map((value) => JSON.stringify(value)).join("\n")
}

function jq(args: string[], input: string) {
  const result = Bun.spawnSync(["jq", ...args], { stdin: Buffer.from(input) })
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}
