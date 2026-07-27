import { getComponentCatalogue } from "@opentui/solid/components"
import { registerSpinner } from "opentui-spinner/solid"

export function registerHenaSpinner() {
  if (!getComponentCatalogue().spinner) registerSpinner()
}
