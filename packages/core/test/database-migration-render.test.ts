import { describe, expect, test } from "bun:test"
import { renderMigration } from "../script/migration-render"

describe("migration rendering", () => {
  test("moves foreign key pragmas into migration metadata", () => {
    const rendered = renderMigration(
      "rebuild",
      "PRAGMA foreign_keys = OFF;--> statement-breakpointCREATE TABLE next (id text);--> statement-breakpointpragma foreign_keys=on;",
    )

    expect(rendered).toContain("disableForeignKeys: true")
    expect(rendered).toContain("CREATE TABLE next")
    expect(rendered.toLowerCase()).not.toContain("pragma foreign_keys")
  })

  test("leaves ordinary migrations on the default policy", () => {
    const rendered = renderMigration("ordinary", "CREATE TABLE next (id text);")

    expect(rendered).not.toContain("disableForeignKeys")
  })
})
