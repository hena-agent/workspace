import { Database } from "bun:sqlite"
import { createSyncDatabase } from "../src/storage/database"

export function createTestDatabase() {
  const filename = `${process.env.TMPDIR ?? "/tmp"}/hena-server-v3-${crypto.randomUUID()}.sqlite`
  const open = () => createSyncDatabase(new Database(filename, { create: true }))

  return { database: open(), reopen: open }
}
