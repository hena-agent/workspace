export function renderMigration(name: string, sql: string) {
  const statements = splitStatements(sql)
  const disableForeignKeys = statements.some(isForeignKeysOff)
  return `import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: ${JSON.stringify(name)},
${disableForeignKeys ? "  disableForeignKeys: true,\n" : ""}  up(tx) {
    return Effect.gen(function* () {
${renderStatements(disableForeignKeys ? statements.filter((statement) => !isForeignKeysPragma(statement)) : statements)}
    })
  },
} satisfies DatabaseMigration.Migration
`
}

export function renderSchema(sql: string) {
  return `import { Effect } from "effect"
import type { DatabaseMigration } from "./migration"

export default {
  up(tx) {
    return Effect.gen(function* () {
${renderStatements(splitStatements(sql))}
    })
  },
} satisfies Omit<DatabaseMigration.Migration, "id">
`
}

function splitStatements(sql: string) {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
}

function renderStatements(statements: string[]) {
  return statements.map(renderRun).join("\n")
}

function isForeignKeysPragma(statement: string) {
  return /^PRAGMA\s+foreign_keys\s*=\s*(?:OFF|ON)\s*;?$/i.test(statement)
}

function isForeignKeysOff(statement: string) {
  return /^PRAGMA\s+foreign_keys\s*=\s*OFF\s*;?$/i.test(statement)
}

function renderRun(statement: string) {
  const lines = statement.replaceAll("\t", "  ").split("\n")
  if (lines.length === 1) return `      yield* tx.run(\`${escapeTemplate(lines[0])}\`)`
  return `      yield* tx.run(\`\n${lines.map((line) => `        ${escapeTemplate(line)}`).join("\n")}\n      \`)`
}

function escapeTemplate(line: string) {
  return line.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${")
}
