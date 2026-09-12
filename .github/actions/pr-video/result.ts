import { lstat, readdir } from "node:fs/promises"
import path from "node:path"

export function gate(text: string) {
  const lines = text.trim().split(/\r?\n/)
  return {
    record: lines[0] === "RECORD: yes" && lines.length === 2 && Boolean(lines[1].trim()),
    reason: lines[1]?.trim() || "No valid browser eligibility verdict was returned.",
  }
}

// The artifact is model/PR-controlled. Only inspect bounded, regular MP4 files;
// never accept attachment paths supplied by the model as command arguments.
export async function prepare(directory: string, text: string) {
  if (!(await lstat(directory)).isDirectory()) throw new Error("Recording directory must be a directory")
  const clips: string[] = []
  const notes: string[] = []
  for (const name of (await readdir(directory)).sort()) {
    if (!/^\d{2}-[a-z0-9-]+\.mp4$/.test(name)) {
      if (/\.(mp4|webm|mov)$/i.test(name))
        notes.push("A recording was omitted: filenames must use NN-lowercase-name.mp4.")
      continue
    }
    const file = await lstat(path.join(directory, name))
    const reason = !file.isFile()
      ? "not a regular file"
      : file.size === 0 || file.size >= 10_000_000
        ? `${file.size} bytes; clips must be nonempty and under 10000000 bytes`
        : clips.length >= 8
          ? "eight-clip limit reached"
          : mediaError(path.join(directory, name))
    if (reason) {
      notes.push(`${name}: ${reason}`)
      continue
    }
    clips.push(`tmp/pr-video/${name}`)
  }
  const referenced = new Set<string>()
  const body = text.slice(0, 24_000).replace(/!\[[^\]]*\]\(([^)]+)\)/g, (_, reference: string) => {
    if (clips.includes(reference) && !referenced.has(reference)) {
      referenced.add(reference)
      return `\n\n![](${reference})\n\n`
    }
    if (!clips.includes(reference)) {
      notes.push(
        /^tmp\/pr-video\/\d{2}-[a-z0-9-]+\.mp4$/.test(reference)
          ? `${path.basename(reference)}: recording unavailable`
          : "A video reference was removed because it did not identify an accepted clip.",
      )
    }
    return ""
  })
  return {
    clips,
    body: [
      body.trim() ||
        (clips.length ? "Completed recordings are included below." : "No browser-verifiable path could be recorded."),
      ...clips
        .filter((clip) => !referenced.has(clip))
        .map((clip) => `### ${path.basename(clip, ".mp4")}\n\n![](${clip})`),
      ...(notes.length ? [`### Unavailable clips\n\n${notes.map((note) => `- ${note}`).join("\n")}`] : []),
    ].join("\n\n"),
  }
}

function mediaError(file: string) {
  const result = Bun.spawnSync(
    [
      "ffprobe",
      "-v",
      "error",
      "-protocol_whitelist",
      "file",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,r_frame_rate:format=duration",
      "-of",
      "json",
      file,
    ],
    { timeout: 10_000 },
  )
  if (result.exitCode !== 0) return "invalid or unfinished video"
  const media = JSON.parse(result.stdout.toString()) as {
    streams?: { codec_name?: string; r_frame_rate?: string }[]
    format?: { duration?: string }
  }
  const duration = Number(media.format?.duration)
  if (media.streams?.[0]?.codec_name !== "h264" || media.streams[0].r_frame_rate !== "60/1") {
    return "requires H.264 at 60 fps"
  }
  if (!(duration > 0 && duration <= 20)) return "requires duration of at most 20 seconds"
  return ""
}
