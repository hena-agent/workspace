import type { SyncDatabase } from "../storage/database"
import type { Subscription } from "./registry"

export function createFrameFactory(input: {
  database: SyncDatabase
  streamId: string
  generation: number
  subscription: Subscription
}) {
  return (frame: Record<string, unknown>) => ({
    protocolVersion: 1,
    ...input.database.feed.get(),
    streamId: input.streamId,
    generation: input.generation,
    subscriptionRevision: input.subscription.revision,
    ...frame,
  })
}
