import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260802090550_project-attachment",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`project_attachment\` (
          \`source_project_id\` text PRIMARY KEY,
          \`requested_folder\` text NOT NULL,
          \`source_scratch\` text NOT NULL,
          \`attachment\` text NOT NULL,
          \`relocations\` text NOT NULL,
          \`checkout\` text NOT NULL,
          \`cleanup_status\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
