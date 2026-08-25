import path from "node:path"

const root = path.resolve(import.meta.dirname, "../..")
const source = path.join(root, "script/opencode/codex-web-search.ts")
const target = path.join(root, ".opencode/plugin/codex-web-search.ts")

async function main() {
  const content = await Bun.file(source).text()
  if (process.argv.includes("--check")) {
    const current = (await Bun.file(target).exists()) ? await Bun.file(target).text() : ""
    if (current === content) return
    console.error(`${path.relative(root, target)} is stale; run bun run build:opencode-plugin`)
    process.exitCode = 1
    return
  }

  await Bun.write(target, content)
}

await main()
