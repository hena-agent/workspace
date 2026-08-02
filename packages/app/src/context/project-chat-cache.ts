import type { ProjectChat } from "@hena/sdk/v2/client"

export function createProjectChatCache() {
  const overrides = new Map<string, { value?: ProjectChat; after: number }>()
  let value: ProjectChat[] = []
  let requested = 0
  let applied = 0
  let loaded = false

  return {
    list: () => value,
    loaded: () => loaded,
    upsert(chat: ProjectChat) {
      overrides.set(chat.id, { value: chat, after: requested })
      value = [chat, ...value.filter((item) => item.id !== chat.id)]
    },
    remove(id: string) {
      overrides.set(id, { after: requested })
      value = value.filter((item) => item.id !== id)
    },
    async load(fetch: () => Promise<ProjectChat[]>) {
      const sequence = ++requested
      const items = await fetch()
      if (sequence < applied) return value
      applied = sequence
      loaded = true

      const fetched = new Map(items.map((item) => [item.id, item]))
      const optimistic: ProjectChat[] = []
      for (const [id, override] of overrides) {
        if (sequence > override.after && (override.value ? fetched.has(id) : !fetched.has(id))) overrides.delete(id)
        if (!override.value) fetched.delete(id)
        if (override.value && !fetched.has(id)) optimistic.push(override.value)
        if (override.value && fetched.has(id)) fetched.set(id, override.value)
      }
      value = [...optimistic.toReversed(), ...fetched.values()]
      return value
    },
  }
}
