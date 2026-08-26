import { GlobalRegistrator } from "@happy-dom/global-registrator"

// Register the DOM globals before anything else loads. `@testing-library/dom`
// binds its `screen` singleton to `document.body` at module-evaluation time,
// and static imports are hoisted above this call — so importing
// `@testing-library/react` at the top of this file would evaluate `screen`
// against an undefined `document`. Dynamic imports below run in place instead.
GlobalRegistrator.register()

const { afterEach, expect } = await import("bun:test")
const { cleanup } = await import("@testing-library/react")
const matchers = await import("@testing-library/jest-dom/matchers")

expect.extend(matchers)

afterEach(() => {
  cleanup()
})
