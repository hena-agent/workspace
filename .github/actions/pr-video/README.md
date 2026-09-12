# PR videos

`pr-video.yml` runs on non-draft PR opens and when the `pr-video` label is added.
Open events use a free-model eligibility gate on every PR, including backend-only
diffs. The label is a deliberate request and bypasses the gate, including on drafts.
Remove and re-add the label to request a new run. Pushes do not start another run.

## Configuration

- `VIDEO_MODEL` variable: `anthropic/claude-sonnet-5@max` by default.
- `VIDEO_GATE_MODEL` variable: `opencode/muse-spark-1.3-contributor-free@xhigh` by default.
- `PR_VIDEO_TOKEN` secret: OAuth token or PAT with repository write access and
  permission to post PR comments.
- `OPENCODE_GO_AUTH_JSON` secret: optional `{"opencode-go":{"type":"api","key":"…"}}`
  for the app's free model flows.

Both model variables support `provider/model@variant` or `off`. Recorder and gate
credentials use the provider mapping in `_review-model.yml` (by default
`OPENCODE_AUTH_JSON` and `OPENCODE_ZEN_AUTH_JSON`, respectively). The app receives
only the extracted opencode-go API credential, not the recorder credential.

**GitHub App installation tokens and `GITHUB_TOKEN` cannot upload attachments.**
GitHub CLI 2.99+ checks this explicitly. `PR_VIDEO_TOKEN` is used only by the
separate publish job, and the comment is attributed to that token's user. See
[GitHub CLI attachment docs](https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli).
Configure it before the first recording run; missing/unsupported credentials fail
publishing and leave the recordings available as a workflow artifact.

## Runtime contract

- App V3 only; the embedded build and Server V3 start on port 4117 before the agent.
- Workflow code installs the pinned agent-browser CLI and its skill internally;
  `ffmpeg` is installed for recording. Hosted Ubuntu 24.04's preinstalled Chrome
  avoids browser downloads and cache transfers. The CLI itself is cached.
- The agent reads prefetched PR context and invokes agent-browser. It cannot use
  arbitrary shell commands, edit tools, or subagents. `opencode run` has no automatic
  commit, push, or comment behavior. Tool permissions are not an OS sandbox.
- One fresh PR comment contains all accepted clips, tied to the recorded head SHA.
  A head/base change before publishing suppresses stale results.
- At most eight H.264 MP4 clips, each at 60 fps, at most 20 seconds, and **strictly
  under 10,000,000 bytes**. The publisher verifies media metadata and file sizes,
  rejects symlinks/non-files, reconciles references, and explains omitted clips.
- Gate rejection produces only a job summary. A human request with no clips gets
  a short explanation comment. Build/boot failure is a failed check. Model timeouts
  preserve finalized clips; recordings and failure logs are retained for seven days.

The browser-automation command permits only localhost navigation and asks the
agent to select `opencode-go/ox-alpha-free` for app model calls. Missing app auth
disables those paths without preventing other UI recordings. Paths that cannot be
demonstrated or fit within the recording budget must be listed as unrecorded.

## Verification

From `packages/script`: `bun test test/pr-video.test.ts` and `bun typecheck`.
Media-boundary tests use local `ffmpeg`/`ffprobe` (and skip when unavailable);
install them to exercise those checks. Lint workflow changes with
`actionlint .github/workflows/pr-video.yml`.
The first labeled CI run validates the actual provider credentials, hosted browser
startup, and GitHub attachment permission; these cannot be exercised with local
repository configuration alone.
