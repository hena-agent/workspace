import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { ProjectOverviewView } from "./project-overview-view"
import { projects } from "@/mock/fixtures"

describe("ProjectOverviewView", () => {
  test("renders the project name and path", () => {
    render(<ProjectOverviewView project={projects[0]} onNewSession={() => {}} />)
    expect(screen.getByText(projects[0].name)).toBeInTheDocument()
    expect(screen.getByText(projects[0].path)).toBeInTheDocument()
  })

  test("calls onNewSession when clicked", async () => {
    const user = userEvent.setup()
    let called = false
    render(<ProjectOverviewView project={projects[0]} onNewSession={() => (called = true)} />)
    await user.click(screen.getByRole("button", { name: /New session/ }))
    expect(called).toBe(true)
  })
})
