import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260823211539_event-message-id-index",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(
        `CREATE INDEX \`event_type_message_id_idx\` ON \`event\` (\`type\`,json_extract("data", '$.messageID'));`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
