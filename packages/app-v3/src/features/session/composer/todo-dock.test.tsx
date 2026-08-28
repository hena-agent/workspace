import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { TodoDock } from "./todo-dock"
import type { Todo } from "@/lib/types"

const todos: Todo[] = [
  { id: "t1", sessionId: "s1", text: "Add tables", status: "completed" },
  { id: "t2", sessionId: "s1", text: "Wire the state machine", status: "in_progress" },
  { id: "t3", sessionId: "s1", text: "Add tests", status: "pending" },
]

describe("TodoDock", () => {
  test("renders nothing when there are no todos", () => {
    const { container } = render(<TodoDock todos={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  test("shows a remaining count and every todo once expanded", async () => {
    const user = userEvent.setup()
    render(<TodoDock todos={todos} />)

    expect(screen.getByRole("button", { name: "Todos · 2 remaining of 3" }).querySelector("svg")).toBeInTheDocument()
    for (const todo of todos) {
      expect(screen.getByText(todo.text)).toBeInTheDocument()
    }

    await user.click(screen.getByText("Todos · 2 remaining of 3"))
    expect(screen.queryByText("Add tables")).not.toBeInTheDocument()
  })
})
