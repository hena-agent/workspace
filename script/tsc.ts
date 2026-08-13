import path from "node:path"

const packageFile = Bun.resolveSync("@typescript/native/package.json", import.meta.dir)
const child = Bun.spawn(
  [process.execPath, path.join(path.dirname(packageFile), "bin", "tsc"), ...Bun.argv.slice(2)],
  {
    cwd: process.cwd(),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
)

process.exitCode = await child.exited
