import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { InboxRequestRow } from "./inbox-request-row"
import { listInboxItems } from "@/mock/queries"
import { MOCK_NOW } from "@/mock/fixtures"

const [item] = listInboxItems()

describe("InboxRequestRow", () => {
  test("renders the request title, project, and session", () => {
    render(<InboxRequestRow item={item} now={MOCK_NOW} onOpen={() => {}} />)
    expect(screen.getByText(item.title)).toBeInTheDocument()
    expect(screen.getByText(new RegExp(item.project.name))).toBeInTheDocument()
  })

  test("calls onOpen when clicked", async () => {
    const user = userEvent.setup()
    let opened = false

    render(<InboxRequestRow item={item} now={MOCK_NOW} onOpen={() => (opened = true)} />)
    await user.click(screen.getByText(item.title))

    expect(opened).toBe(true)
  })
})
