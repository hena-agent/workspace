import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260827094054_durable_project_attach",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`project_attach_directory\` (
          \`operation_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`type\` text,
          \`strategy\` text,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`project_attach_directory_pk\` PRIMARY KEY(\`operation_id\`, \`directory\`),
          CONSTRAINT \`fk_project_attach_directory_operation_id_project_attach_operation_id_fk\` FOREIGN KEY (\`operation_id\`) REFERENCES \`project_attach_operation\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`project_attach_operation\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`source\` text NOT NULL,
          \`target\` text NOT NULL,
          \`staging\` text NOT NULL,
          \`target_existed\` integer NOT NULL,
          \`phase\` text NOT NULL,
          \`error\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`project_attach_session\` (
          \`operation_id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`path\` text,
          \`workspace_id\` text,
          \`forward_event_id\` text NOT NULL,
          \`rollback_event_id\` text NOT NULL,
          CONSTRAINT \`project_attach_session_pk\` PRIMARY KEY(\`operation_id\`, \`session_id\`),
          CONSTRAINT \`fk_project_attach_session_operation_id_project_attach_operation_id_fk\` FOREIGN KEY (\`operation_id\`) REFERENCES \`project_attach_operation\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`project_attach_operation_project_updated_idx\` ON \`project_attach_operation\` (\`project_id\`,\`time_updated\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
