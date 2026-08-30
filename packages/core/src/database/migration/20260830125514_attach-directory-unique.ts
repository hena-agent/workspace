import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260830125514_attach-directory-unique",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(
        `CREATE UNIQUE INDEX \`project_directory_attach_directory_idx\` ON \`project_directory\` (\`directory\`) WHERE "project_directory"."strategy" = 'attach';`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
