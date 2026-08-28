export function time(input: number): string {
  return new Date(input).toLocaleTimeString(undefined, { timeStyle: "short" })
}

export function datetime(input: number): string {
  return `${time(input)} · ${new Date(input).toLocaleDateString()}`
}

export function todayTimeOrDateTime(input: number): string {
  const date = new Date(input)
  const now = new Date()
  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()) {
    return time(input)
  }
  return datetime(input)
}

export function truncate(value: string, length: number): string {
  if (value.length <= length) return value
  return value.slice(0, length - 1) + "…"
}

export * as Locale from "./locale"
