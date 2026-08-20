import { isOneOf } from "./utils"

export const THEME_VALUES = ["dark", "light", "system"] as const

export type Theme = (typeof THEME_VALUES)[number]

export function isTheme(value: string | null): value is Theme {
  return value !== null && isOneOf(THEME_VALUES, value)
}
