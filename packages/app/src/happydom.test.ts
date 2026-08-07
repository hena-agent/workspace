import { expect, test } from "bun:test"

// Covers the MutationObserver callback pin installed by ../happydom.ts, using the attached
// subtree shape that observe-element-offset.ts observes in production.
test("MutationObserver callbacks survive garbage collection", async () => {
  const nativeWeakRef = globalThis.WeakRef
  const target = document.createElement("div")
  document.body.append(target)
  const callbacks: MutationRecord[][] = []
  const observer = new MutationObserver((records) => callbacks.push(records))
  observer.observe(document.body, { childList: true, subtree: true })

  Bun.gc(true)
  target.append(document.createElement("span"))
  await Promise.resolve()

  expect(callbacks).toHaveLength(1)
  expect(globalThis.WeakRef).toBe(nativeWeakRef)
  observer.disconnect()
  target.remove()
})
