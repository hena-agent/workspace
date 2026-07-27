export function hasExistingAppState(entries: Array<{ name: string; isDirectory: () => boolean }>) {
  return entries.some((entry) => {
    if (entry.name === "hena.settings") return true
    if (entry.name.endsWith(".dat")) return true
    if (/^window-state-.+\.json$/.test(entry.name)) return true
    return entry.isDirectory() && entry.name === "hena"
  })
}
