import { createTransaction } from "@tanstack/db"
import type { Sync } from "@hena/schema/sync"
import type { ConnectionAgent } from "@/connection/agent"
import { awaitReceipt, requestQueueable } from "./lifecycle"

export function replaceSettingOptimistically(agent: ConnectionAgent, input: { scope: string; key: string; value: Sync.SettingReplace["value"] }) {
  const current = agent.store.collection("settings", input.scope).toArray.find((item) => item.__key === input.key)
  const idempotencyKey = crypto.randomUUID()
  const transaction = createTransaction({
    mutationFn: async () => {
      const result = await requestQueueable(() => agent.client.api.settings[":scope"][":key"].$put({
          param: { scope: encodeURIComponent(input.scope), key: input.key },
          json: { idempotencyKey, expectedRevision: current?.__revision, value: input.value },
      }))
      await awaitReceipt(agent, result)
    },
  })
  transaction.mutate(() => {
    const collection = agent.store.collection("settings", input.scope)
    if (current) {
      collection.update(input.key, (draft) => {
        draft.row = { ...draft.row, value: input.value }
      })
      return
    }
    collection.insert({ __key: input.key, row: { key: input.key, scope: input.scope, value: input.value } })
  })
  return transaction.isPersisted.promise
}
