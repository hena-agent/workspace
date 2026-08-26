import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260823094804_server-v3-sync",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`collection_change\` (
          \`seq\` integer PRIMARY KEY AUTOINCREMENT,
          \`collection\` text NOT NULL,
          \`scope_key\` text NOT NULL,
          \`row_key\` text NOT NULL,
          \`op\` text NOT NULL,
          \`row\` text,
          \`row_revision\` text,
          \`txid\` text,
          \`runtime_id\` text NOT NULL,
          \`created_at\` integer NOT NULL,
          CONSTRAINT "collection_change_operation" CHECK("op" IN ('insert', 'update', 'delete', 'reset'))
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`collection_feed\` (
          \`id\` integer PRIMARY KEY,
          \`feed_id\` text NOT NULL,
          \`retained_floor\` integer NOT NULL,
          \`runtime_id\` text NOT NULL,
          CONSTRAINT "collection_feed_singleton" CHECK("id" = 1)
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`collection_row\` (
          \`collection\` text NOT NULL,
          \`scope_key\` text NOT NULL,
          \`row_key\` text NOT NULL,
          \`row\` text NOT NULL,
          \`row_revision\` text NOT NULL,
          CONSTRAINT \`collection_row_pk\` PRIMARY KEY(\`collection\`, \`scope_key\`, \`row_key\`)
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`full_content\` (
          \`id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`revision\` text NOT NULL,
          \`content\` text NOT NULL,
          \`created_at\` integer NOT NULL,
          CONSTRAINT \`full_content_pk\` PRIMARY KEY(\`id\`, \`session_id\`, \`revision\`)
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`idempotency_record\` (
          \`principal\` text NOT NULL,
          \`operation\` text NOT NULL,
          \`key\` text NOT NULL,
          \`fingerprint\` text NOT NULL,
          \`response\` text NOT NULL,
          \`txid\` text NOT NULL,
          \`created_at\` integer NOT NULL,
          CONSTRAINT \`idempotency_record_pk\` PRIMARY KEY(\`principal\`, \`operation\`, \`key\`)
        );
      `)
      yield* tx.run(`ALTER TABLE \`session_input\` ADD \`queue_position\` integer DEFAULT 0 NOT NULL;`)
      yield* tx.run(`UPDATE \`session_input\` SET \`queue_position\` = \`admitted_seq\`;`)
      yield* tx.run(`ALTER TABLE \`session\` ADD \`queue_revision\` integer DEFAULT 0 NOT NULL;`)
      yield* tx.run(`
        UPDATE \`session\`
        SET \`queue_revision\` = (
          SELECT COUNT(*) FROM \`event\`
          WHERE \`event\`.\`aggregate_id\` = \`session\`.\`id\`
            AND \`event\`.\`type\` IN (
              'session.next.prompt.admitted.1',
              'session.next.prompted.1',
              'session.next.revert.committed.1'
            )
        );
      `)
      yield* tx.run(`ALTER TABLE \`todo\` ADD \`id\` text;`)
      yield* tx.run(`UPDATE \`todo\` SET \`id\` = 'todo_' || lower(hex(randomblob(16)));`)
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
        `INSERT INTO \`__new_todo\`(\`id\`, \`session_id\`, \`content\`, \`status\`, \`priority\`, \`position\`, \`time_created\`, \`time_updated\`) SELECT \`id\`, \`session_id\`, \`content\`, \`status\`, \`priority\`, \`position\`, \`time_created\`, \`time_updated\` FROM \`todo\`;`,
      )
      yield* tx.run(`DROP TABLE \`todo\`;`)
      yield* tx.run(`ALTER TABLE \`__new_todo\` RENAME TO \`todo\`;`)
      yield* tx.run(`PRAGMA foreign_keys=ON;`)
      yield* tx.run(`CREATE UNIQUE INDEX \`todo_session_position_idx\` ON \`todo\` (\`session_id\`,\`position\`);`)
      yield* tx.run(`CREATE INDEX \`todo_session_idx\` ON \`todo\` (\`session_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`collection_change_scope_seq_idx\` ON \`collection_change\` (\`collection\`,\`scope_key\`,\`seq\`);`,
      )
      yield* tx.run(`CREATE INDEX \`collection_change_created_at_idx\` ON \`collection_change\` (\`created_at\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
