import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260911182441_session-input-selection",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_input\` ADD \`selection\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
