import { getComponentCatalogue } from "@opentui/solid/components"
import { registerSpinner } from "opentui-spinner/solid"

export function registerHenaAgentSpinner() {
  if (!getComponentCatalogue().spinner) registerSpinner()
}
