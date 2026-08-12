import { describe, expect, test } from "bun:test"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test/test-utils"
import { SessionTranscriptView } from "./session-transcript-view"
import { agents, models, sessions } from "@/mock/fixtures"
import { getPermissionRequest, getQuestionRequest, listMessages, listTodos } from "@/mock/queries"

function noop() {}

function renderView(sessionId: string) {
  const session = sessions.find((s) => s.id === sessionId)!
  return render(
    <SessionTranscriptView
      session={session}
      messages={listMessages(sessionId)}
      todos={listTodos(sessionId)}
      permissionRequest={getPermissionRequest(sessionId)}
      questionRequest={getQuestionRequest(sessionId)}
      agents={agents}
      models={models}
      agentId={agents[0].id}
      modelId={models[0].id}
      onChangeAgent={noop}
      onChangeModel={noop}
      onSend={noop}
      onShare={noop}
      onFork={noop}
      onArchive={noop}
      onDenyPermission={noop}
      onAllowPermissionOnce={noop}
      onAllowPermissionAlways={noop}
      onAnswerQuestion={noop}
    />,
  )
}

describe("SessionTranscriptView", () => {
  test("renders the header, messages, and composer for a plain session", () => {
    renderView("sess-transcript")
    expect(screen.getByRole("heading")).toHaveTextContent("collection stream protocol")
    expect(screen.getByRole("log", { name: "Messages" })).toBeInTheDocument()
    expect(screen.getByLabelText("Message")).toBeInTheDocument()
  })

  test("shows the permission dock only for a session with a pending permission request", () => {
    renderView("sess-permission")
    expect(screen.getByText("Run secret-rotation script")).toBeInTheDocument()
  })

  test("shows the question dock only for a session with a pending question", () => {
    renderView("sess-question")
    expect(screen.getByText("Which retention window should the changelog table enforce?")).toBeInTheDocument()
  })

  test("sending a message calls onSend with the trimmed text", async () => {
    const user = userEvent.setup()
    const session = sessions.find((s) => s.id === "sess-transcript")!
    const sent: string[] = []

    render(
      <SessionTranscriptView
        session={session}
        messages={listMessages("sess-transcript")}
        todos={listTodos("sess-transcript")}
        agents={agents}
        models={models}
        agentId={agents[0].id}
        modelId={models[0].id}
        onChangeAgent={noop}
        onChangeModel={noop}
        onSend={(text) => sent.push(text)}
        onShare={noop}
        onFork={noop}
        onArchive={noop}
        onDenyPermission={noop}
        onAllowPermissionOnce={noop}
        onAllowPermissionAlways={noop}
        onAnswerQuestion={noop}
      />,
    )

    await user.type(screen.getByLabelText("Message"), "Status update?")
    await user.click(screen.getByRole("button", { name: "Send message" }))
    expect(sent).toEqual(["Status update?"])
  })
})
