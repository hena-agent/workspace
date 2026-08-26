import { describe, expect, test } from "bun:test"
import { render, screen } from "@/test/test-utils"
import { ConnectionStatusDot } from "./connection-status-dot"

describe("ConnectionStatusDot", () => {
  test.each([
    ["online", "Online"],
    ["connecting", "Connecting"],
    ["offline", "Offline"],
  ] as const)("labels %s as %s", (status, label) => {
    render(<ConnectionStatusDot status={status} />)
    expect(screen.getByRole("status", { name: label })).toBeInTheDocument()
  })
})
