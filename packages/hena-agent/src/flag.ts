import { Flag as CoreFlag } from "@hena-agent/core/flag/flag"

function value(key: string) {
  return process.env[key]
}

export function truthy(key: string) {
  const current = value(key)?.toLowerCase()
  return current === "true" || current === "1"
}

export const Flag = new Proxy(CoreFlag, {
  get(target, property, receiver) {
    if (typeof property !== "string" || !property.startsWith("HENA_AGENT_")) {
      return Reflect.get(target, property, receiver)
    }
    const current = Reflect.get(target, property, receiver)
    const configured = value(property)
    if (configured === undefined) return current
    return typeof current === "boolean" ? truthy(property) : configured
  },
})
