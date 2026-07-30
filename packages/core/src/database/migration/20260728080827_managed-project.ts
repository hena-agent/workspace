import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260728080827_managed-project",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`project\` ADD \`managed\` integer DEFAULT false NOT NULL;`)
      yield* tx.run(`ALTER TABLE \`project\` ADD \`folder\` text;`)
      yield* tx.run(`CREATE UNIQUE INDEX \`project_folder_idx\` ON \`project\` (\`folder\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
