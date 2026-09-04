import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260903041953_session-read-watermark",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`time_read\` integer;`)
      // Backfill existing sessions as read so upgrading does not mark every session unread.
      yield* tx.run(`UPDATE \`session\` SET \`time_read\` = \`time_updated\`;`)
    })
  },
} satisfies DatabaseMigration.Migration
