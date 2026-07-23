import { Flag } from "@hena-agent/core/flag/flag"
import { Effect } from "effect"
import path from "path"

const preserveExerciseGlobalRoot = !!process.env.HENA_AGENT_HTTPAPI_EXERCISE_GLOBAL
export const exerciseGlobalRoot =
  process.env.HENA_AGENT_HTTPAPI_EXERCISE_GLOBAL ??
  path.join(process.env.TMPDIR ?? "/tmp", `hena-agent-httpapi-global-${process.pid}`)
process.env.XDG_DATA_HOME = path.join(exerciseGlobalRoot, "data")
process.env.XDG_CONFIG_HOME = path.join(exerciseGlobalRoot, "config")
process.env.XDG_STATE_HOME = path.join(exerciseGlobalRoot, "state")
process.env.XDG_CACHE_HOME = path.join(exerciseGlobalRoot, "cache")
process.env.HENA_AGENT_DISABLE_SHARE = "true"
export const exerciseConfigDirectory = path.join(exerciseGlobalRoot, "config", "hena-agent")
export const exerciseDataDirectory = path.join(exerciseGlobalRoot, "data", "hena-agent")

const preserveExerciseDatabase = !!process.env.HENA_AGENT_HTTPAPI_EXERCISE_DB
export const exerciseDatabasePath =
  process.env.HENA_AGENT_HTTPAPI_EXERCISE_DB ??
  path.join(process.env.TMPDIR ?? "/tmp", `hena-agent-httpapi-exercise-${process.pid}.db`)
process.env.HENA_AGENT_DB = exerciseDatabasePath
Flag.HENA_AGENT_DB = exerciseDatabasePath

export const original = {
  HENA_AGENT_SERVER_PASSWORD: Flag.HENA_AGENT_SERVER_PASSWORD,
  HENA_AGENT_SERVER_USERNAME: Flag.HENA_AGENT_SERVER_USERNAME,
}

export const cleanupExercisePaths = Effect.promise(async () => {
  const fs = await import("fs/promises")
  if (!preserveExerciseDatabase) {
    await Promise.all(
      [exerciseDatabasePath, `${exerciseDatabasePath}-wal`, `${exerciseDatabasePath}-shm`].map((file) =>
        fs.rm(file, { force: true }).catch(() => undefined),
      ),
    )
  }
  if (!preserveExerciseGlobalRoot)
    await fs.rm(exerciseGlobalRoot, { recursive: true, force: true }).catch(() => undefined)
})
