import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen, within } from "@/test/test-utils"
import { ReviewView } from "./review-view"
import { listDiffFiles } from "@/mock/queries"

const files = listDiffFiles("sess-transcript")

describe("ReviewView", () => {
  test("shows an empty state when there are no changes", () => {
    render(<ReviewView files={[]} onSelectFile={() => {}} />)
    expect(screen.getByText("No changes yet.")).toBeInTheDocument()
  })

  test("defaults to the first file's diff when nothing is selected", () => {
    render(<ReviewView files={files} onSelectFile={() => {}} />)
    expect(screen.getAllByText(files[0].path).length).toBeGreaterThan(0)
  })

  test("selecting a file calls onSelectFile with its path", async () => {
    const user = userEvent.setup()
    const selected: string[] = []

    render(<ReviewView files={files} onSelectFile={(path) => selected.push(path)} />)
    await user.click(screen.getByText(files[1].path))

    expect(selected).toEqual([files[1].path])
  })

  test("shows the diff for the given activePath", () => {
    render(<ReviewView files={files} activePath={files[2].path} onSelectFile={() => {}} />)
    const fileList = screen.getByRole("list", { name: "Changed files" })
    const activeButton = within(fileList).getByText(files[2].path).closest("button")
    expect(activeButton).toHaveAttribute("aria-current", "true")
  })
})
