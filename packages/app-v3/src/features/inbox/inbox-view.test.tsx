import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { InboxView } from "./inbox-view"
import { listInboxItems } from "@/mock/queries"
import { projects, MOCK_NOW } from "@/mock/fixtures"

function noop() {}

describe("InboxView", () => {
  test("renders a row per inbox item", () => {
    const items = listInboxItems()
    render(
      <InboxView
        items={items}
        recentProjects={[]}
        now={MOCK_NOW}
        onOpenItem={noop}
        onOpenProject={noop}
        onAddProject={noop}
      />,
    )
    for (const item of items) {
      expect(screen.getByText(item.title)).toBeInTheDocument()
    }
  })

  test("shows the empty state when there is nothing pending", () => {
    render(
      <InboxView
        items={[]}
        recentProjects={[]}
        now={MOCK_NOW}
        onOpenItem={noop}
        onOpenProject={noop}
        onAddProject={noop}
      />,
    )
    expect(screen.getByText("Nothing needs you right now.")).toBeInTheDocument()
  })

  test("selecting an inbox item calls onOpenItem with it", async () => {
    const user = userEvent.setup()
    const items = listInboxItems()
    const opened: string[] = []

    render(
      <InboxView
        items={items}
        recentProjects={[]}
        now={MOCK_NOW}
        onOpenItem={(item) => opened.push(item.id)}
        onOpenProject={noop}
        onAddProject={noop}
      />,
    )

    await user.click(screen.getByText(items[0].title))
    expect(opened).toEqual([items[0].id])
  })

  test("selecting a recent project calls onOpenProject with its id", async () => {
    const user = userEvent.setup()
    const opened: string[] = []

    render(
      <InboxView
        items={[]}
        recentProjects={[projects[0]]}
        now={MOCK_NOW}
        onOpenItem={noop}
        onOpenProject={(id) => opened.push(id)}
        onAddProject={noop}
      />,
    )

    await user.click(screen.getByText(projects[0].path))
    expect(opened).toEqual([projects[0].id])
  })
})
