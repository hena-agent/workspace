import { describe, expect, test } from "bun:test"
import { render } from "@/test/test-utils"
import { getFileTree } from "@/mock/queries"
import { FilesView } from "./files-view"

describe("FilesView", () => {
  test("bounds the mobile file tree to a scrollable viewport", () => {
    const view = render(<FilesView tree={getFileTree()} onSelectFile={() => {}} />)

    expect(view.container.firstElementChild?.firstElementChild).toHaveClass("h-[40dvh]", "md:h-auto")
  })
})
