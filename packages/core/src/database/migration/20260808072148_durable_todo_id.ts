import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260808072148_durable_todo_id",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`PRAGMA foreign_keys=OFF;`)
      yield* tx.run(`
        CREATE TABLE \`__new_todo\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`content\` text NOT NULL,
          \`status\` text NOT NULL,
          \`priority\` text NOT NULL,
          \`position\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_todo_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `INSERT INTO \`__new_todo\`(\`id\`, \`session_id\`, \`content\`, \`status\`, \`priority\`, \`position\`, \`time_created\`, \`time_updated\`) SELECT 'todo_' || lower(hex(randomblob(16))), \`session_id\`, \`content\`, \`status\`, \`priority\`, \`position\`, \`time_created\`, \`time_updated\` FROM \`todo\`;`,
      )
      yield* tx.run(`DROP TABLE \`todo\`;`)
      yield* tx.run(`ALTER TABLE \`__new_todo\` RENAME TO \`todo\`;`)
      yield* tx.run(`PRAGMA foreign_keys=ON;`)
      yield* tx.run(`CREATE UNIQUE INDEX \`todo_session_position_idx\` ON \`todo\` (\`session_id\`,\`position\`);`)
      yield* tx.run(`CREATE INDEX \`todo_session_idx\` ON \`todo\` (\`session_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
