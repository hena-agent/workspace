const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Coarse relative-time label. Intentionally coarse (no seconds precision
 * beyond "just now") since it drives list rows, not a live-updating clock. */
export function formatRelativeTime(timestamp: number, now: number): string {
  const delta = now - timestamp

  if (delta < MINUTE) return "just now"
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)}d ago`

  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
