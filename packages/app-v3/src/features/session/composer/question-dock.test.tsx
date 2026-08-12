import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { QuestionDock } from "./question-dock"
import type { QuestionRequest } from "@/lib/types"

const request: QuestionRequest = {
  id: "q1",
  sessionId: "s1",
  prompt: "Which retention window?",
  choices: [
    { id: "c-7d", label: "7 days" },
    { id: "c-30d", label: "30 days" },
  ],
  createdAt: 0,
}

describe("QuestionDock", () => {
  test("renders the prompt and every choice", () => {
    render(<QuestionDock request={request} onChoose={() => {}} />)
    expect(screen.getByText(request.prompt)).toBeInTheDocument()
    for (const choice of request.choices) {
      expect(screen.getByRole("button", { name: choice.label })).toBeInTheDocument()
    }
  })

  test("choosing an option calls onChoose with its id", async () => {
    const user = userEvent.setup()
    const chosen: string[] = []

    render(<QuestionDock request={request} onChoose={(id) => chosen.push(id)} />)
    await user.click(screen.getByRole("button", { name: "30 days" }))

    expect(chosen).toEqual(["c-30d"])
  })
})
