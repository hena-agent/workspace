import { isRecord } from "./record"

export function errorFormat(error: unknown): string {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`

  if (typeof error === "object" && error !== null) {
    try {
      const json = JSON.stringify(error, null, 2)
      if (json !== "{}") return json
      const text = String(error)
      if (text && text !== "[object Object]") return text
      const name = error.constructor?.name
      const prefix = name && name !== "Object" ? name : "Error"
      const properties = Object.getOwnPropertyNames(error)
      return properties.length === 0 ? `${prefix} (no message)` : `${prefix} { ${properties.join(", ")} }`
    } catch {
      return "Unexpected error (unserializable)"
    }
  }

  return String(error)
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message) return error.message
    if (error.name) return error.name
  }
  if (isRecord(error) && typeof error.message === "string" && error.message) return error.message
  if (isRecord(error) && isRecord(error.data) && typeof error.data.message === "string" && error.data.message) {
    return error.data.message
  }
  const text = String(error)
  if (text && text !== "[object Object]") return text
  return errorFormat(error) || "unknown error"
}

export function errorData(error: unknown) {
  if (error instanceof Error) {
    return {
      type: error.name,
      message: errorMessage(error),
      stack: error.stack,
      cause: error.cause === undefined ? undefined : errorFormat(error.cause),
      formatted: errorFormat(error),
    }
  }
  if (!isRecord(error)) {
    return {
      type: typeof error,
      message: errorMessage(error),
      formatted: errorFormat(error),
    }
  }
  const data = Object.getOwnPropertyNames(error).reduce<Record<string, unknown>>((result, key) => {
    const value = error[key]
    if (value === undefined) return result
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[key] = value
      return result
    }
    result[key] = value instanceof Error ? value.message : String(value)
    return result
  }, {})
  if (typeof data.message !== "string") data.message = errorMessage(error)
  if (typeof data.type !== "string") data.type = error.constructor?.name
  data.formatted = errorFormat(error)
  return data
}
