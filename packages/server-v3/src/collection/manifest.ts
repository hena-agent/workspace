export const ListCollections = ["projects", "locations", "sessions", "permissions", "questions"] as const
export const SessionCollections = ["messages", "parts", "sessionInputs", "todos"] as const
export const LocationCollections = ["agents", "models", "providers"] as const

export function requestedScopes(
  subscription: { lists: boolean; sessions: readonly string[] },
  locations: readonly string[] = [],
) {
  return [
    ...(subscription.lists ? ListCollections.map((collection) => ({ collection, scopeKey: "" })) : []),
    ...(subscription.lists ? locations.flatMap((scopeKey) =>
      [...LocationCollections.map((collection) => ({ collection, scopeKey })), { collection: "settings", scopeKey }]
    ) : []),
    ...(subscription.lists ? [{ collection: "settings", scopeKey: "profile" }] : []),
    ...Array.from(new Set(subscription.sessions)).flatMap((scopeKey) =>
      SessionCollections.map((collection) => ({ collection, scopeKey })),
    ),
  ]
}
