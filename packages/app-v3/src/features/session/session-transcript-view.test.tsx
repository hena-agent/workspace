import { describe, expect, test } from "bun:test"
import type { ComponentProps } from "react"
import userEvent from "@testing-library/user-event"
import { render, screen, within } from "@/test/test-utils"
import { SessionTranscriptView } from "./session-transcript-view"
import { agents, models, sessions } from "@/test/fixtures"
import { getPermissionRequest, getQuestionRequest, listMessages, listTodos } from "@/test/queries"

function noop() {}

function renderView(sessionId: string, props?: Partial<ComponentProps<typeof SessionTranscriptView>>) {
  const session = sessions.find((s) => s.id === sessionId)!
  const sessionOwner = { sessionId, connectionId: session.connectionId, projectId: session.projectId }
  return render(
    <SessionTranscriptView
      session={session}
      messages={listMessages(sessionOwner)}
      messagesReady
      todos={listTodos(sessionOwner)}
      permissionRequest={getPermissionRequest(sessionOwner)}
      questionRequest={getQuestionRequest(sessionOwner)}
      agents={agents}
      models={models}
      agentId={agents[0].id}
      model={models[0]}
      onChangeAgent={noop}
      onChangeModel={noop}
      onSend={noop}
      onQueue={noop}
      onShare={noop}
      onFork={noop}
      onArchive={noop}
      onDenyPermission={noop}
      onAllowPermissionOnce={noop}
      onAllowPermissionAlways={noop}
      onAnswerQuestion={noop}
      {...props}
    />,
  )
}

describe("SessionTranscriptView", () => {
  test("renders the title, messages, and composer", () => {
    const view = renderView("sess-transcript")
    expect(view.container.firstElementChild).toHaveClass("w-full", "min-w-0")
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
        messages={listMessages({
          sessionId: session.id,
          connectionId: session.connectionId,
          projectId: session.projectId,
        })}
        messagesReady
        todos={listTodos({
          sessionId: session.id,
          connectionId: session.connectionId,
          projectId: session.projectId,
        })}
        agents={agents}
        models={models}
        agentId={agents[0].id}
        model={models[0]}
        onChangeAgent={noop}
        onChangeModel={noop}
        onSend={(text) => sent.push(text)}
        onQueue={noop}
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

  test("uses queue actions for durable queued inputs", async () => {
    const user = userEvent.setup()
    const moved: string[] = []
    const canceled: string[] = []
    renderView("sess-transcript", {
      queuedInputs: [{ id: "q1", text: "First queued prompt" }, { id: "q2", text: "Second queued prompt" }],
      onMoveInput: (id, direction) => moved.push(`${id}:${direction}`),
      onCancelInput: (id) => canceled.push(id),
    })

    const queue = screen.getByLabelText("Queued messages")
    const first = queue.querySelector<HTMLElement>('[data-queue-input-id="q1"]')!
    await user.click(within(first).getByRole("button", { name: "Down" }))
    await user.click(within(first).getByRole("button", { name: "Cancel" }))

    expect(moved).toEqual(["q1:1"])
    expect(canceled).toEqual(["q1"])
  })
})
