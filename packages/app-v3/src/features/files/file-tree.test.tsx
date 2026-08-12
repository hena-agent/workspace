import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { FileTree } from "./file-tree"
import { getFileTree } from "@/mock/queries"

const tree = getFileTree()

describe("FileTree", () => {
  test("renders top-level and, once expanded, nested entries", async () => {
    const user = userEvent.setup()
    render(<FileTree nodes={tree} onSelectFile={() => {}} />)

    expect(screen.getByText("hena")).toBeInTheDocument()
    expect(screen.getByText("package.json")).toBeInTheDocument()
    expect(screen.getByText("changelog.ts")).toBeInTheDocument()

    await user.click(screen.getByText("collection"))
    expect(screen.queryByText("changelog.ts")).not.toBeInTheDocument()
  })

  test("selecting a file calls onSelectFile with its full path", async () => {
    const user = userEvent.setup()
    const selected: string[] = []

    render(<FileTree nodes={tree} onSelectFile={(path) => selected.push(path)} />)
    await user.click(screen.getByText("changelog.ts"))

    expect(selected).toEqual(["packages/hena/src/server/collection/changelog.ts"])
  })
})
