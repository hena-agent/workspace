export const SERVER_SETTINGS_SECTIONS = [
  { id: "providers", label: "Providers" },
  { id: "models", label: "Models" },
  { id: "mcp", label: "MCP servers" },
  { id: "servers", label: "Server connections" },
  { id: "storage", label: "Storage" },
] as const

export type ServerSettingsSection = (typeof SERVER_SETTINGS_SECTIONS)[number]["id"]
export const SERVER_SETTINGS_SECTION_VALUES: ServerSettingsSection[] = SERVER_SETTINGS_SECTIONS.map(
  (section) => section.id,
)
