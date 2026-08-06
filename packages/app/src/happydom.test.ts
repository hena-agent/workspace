import { expect, test } from "bun:test"

test("MutationObserver callbacks survive garbage collection", async () => {
  const target = document.createElement("div")
  const callbacks: MutationRecord[][] = []
  const observer = new MutationObserver((records) => callbacks.push(records))
  observer.observe(target, { childList: true })

  Bun.gc(true)
  target.append(document.createElement("span"))
  await Promise.resolve()

  expect(callbacks).toHaveLength(1)
  observer.disconnect()
})
