import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260827073015_project-mode",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`project\` ADD \`mode\` text DEFAULT 'workspace' NOT NULL;`)
    })
  },
} satisfies DatabaseMigration.Migration
