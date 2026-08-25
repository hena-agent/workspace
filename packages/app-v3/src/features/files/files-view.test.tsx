import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { getFileTree } from "@/test/queries"
import { FilesView } from "./files-view"

describe("FilesView", () => {
  test("bounds the mobile file tree to a scrollable viewport", () => {
    const view = render(<FilesView tree={getFileTree()} onSelectFile={() => {}} />)

    expect(view.container.firstElementChild?.firstElementChild).toHaveClass("h-[40dvh]", "md:h-auto")
  })

  test("renders project search results and opens the selected file", async () => {
    const user = userEvent.setup()
    const searches: string[] = []
    const selected: string[] = []
    render(
      <FilesView
        tree={getFileTree()}
        search="package"
        searchResults={["package.json"]}
        onSearch={(value) => searches.push(value)}
        onSelectFile={(path) => selected.push(path)}
      />,
    )

    await user.type(screen.getByRole("textbox", { name: "Find in project" }), "s")
    await user.click(screen.getByRole("button", { name: "package.json" }))

    expect(searches).toEqual(["packages"])
    expect(selected).toEqual(["package.json"])
  })
})
