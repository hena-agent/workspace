export const ListCollections = ["projects", "locations", "sessions", "permissions", "questions", "settings"] as const
export const SessionCollections = ["messages", "parts", "sessionInputs", "todos"] as const
export const LocationCollections = ["agents", "models", "providers"] as const

export function requestedScopes(
  subscription: { lists: boolean; sessions: readonly string[] },
  locations: readonly string[] = [],
) {
  return [
    ...(subscription.lists ? ListCollections.map((collection) => ({ collection, scopeKey: "" })) : []),
    ...(subscription.lists ? locations.flatMap((scopeKey) =>
      LocationCollections.map((collection) => ({ collection, scopeKey }))
    ) : []),
    ...subscription.sessions.flatMap((scopeKey) =>
      SessionCollections.map((collection) => ({ collection, scopeKey })),
    ),
  ]
}
