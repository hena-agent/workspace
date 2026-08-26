type SidebarStore = { version: 1; open: boolean }

const STORAGE_KEY = "hena.sidebar.v1"

export function loadSidebarOpen(storage: Storage = localStorage): boolean | undefined {
  const value = record(parse(storage.getItem(STORAGE_KEY)))
  return value.version === 1 && typeof value.open === "boolean" ? value.open : undefined
}

export function saveSidebarOpen(open: boolean, storage: Storage = localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, open } satisfies SidebarStore))
}

function parse(value: string | null) {
  if (!value) return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
