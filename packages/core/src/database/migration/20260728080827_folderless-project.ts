import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260728080827_folderless-project",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`PRAGMA foreign_keys=OFF;`)
      yield* tx.run(`CREATE TABLE \`__new_project\` (
        \`id\` text PRIMARY KEY,
        \`worktree\` text,
        \`vcs\` text,
        \`name\` text,
        \`icon_url\` text,
        \`icon_url_override\` text,
        \`icon_color\` text,
        \`time_created\` integer NOT NULL,
        \`time_updated\` integer NOT NULL,
        \`time_initialized\` integer,
        \`sandboxes\` text NOT NULL,
        \`commands\` text
      );`)
      yield* tx.run(`INSERT INTO \`__new_project\` SELECT
        \`id\`, \`worktree\`, \`vcs\`, \`name\`, \`icon_url\`, \`icon_url_override\`, \`icon_color\`,
        \`time_created\`, \`time_updated\`, \`time_initialized\`, \`sandboxes\`, \`commands\`
        FROM \`project\`;`)
      yield* tx.run(`DROP TABLE \`project\`;`)
      yield* tx.run(`ALTER TABLE \`__new_project\` RENAME TO \`project\`;`)
      yield* tx.run(`PRAGMA foreign_keys=ON;`)
    })
  },
} satisfies DatabaseMigration.Migration
