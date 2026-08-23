import type { Database } from "bun:sqlite"

export type Feed = {
  feedId: string
  retainedFloor: number
  runtimeId: string
}

type FeedRow = {
  feed_id: string
  retained_floor: number
  runtime_id: string
}

export function createFeedStore(database: Database) {
  const runtimeId = crypto.randomUUID()
  database.query("INSERT OR IGNORE INTO collection_feed (id, feed_id, retained_floor, runtime_id) VALUES (1, ?, 0, ?)").run(crypto.randomUUID(), runtimeId)
  database.query("UPDATE collection_feed SET runtime_id = ? WHERE id = 1").run(runtimeId)

  return {
    get(): Feed {
      const row = database.query<FeedRow, []>("SELECT feed_id, retained_floor, runtime_id FROM collection_feed WHERE id = 1").get()
      if (!row) throw new Error("collection feed is missing")
      return { feedId: row.feed_id, retainedFloor: row.retained_floor, runtimeId: row.runtime_id }
    },
    advanceRetainedFloor(retainedFloor: number) {
      database.query("UPDATE collection_feed SET retained_floor = MAX(retained_floor, ?) WHERE id = 1").run(retainedFloor)
    },
  }
}
