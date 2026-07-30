import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260728102816_session-mode",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`mode\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
