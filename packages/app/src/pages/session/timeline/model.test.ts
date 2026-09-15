import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Message, UserMessage } from "@hena/sdk/v2"
import { isTimelineReady, loadOlderTimeline, selectUserMessages, selectVisibleUserMessages } from "./model"
import { splitAtMessage } from "../message-order"

const user = (id: string) => ({ id, role: "user" }) as UserMessage
const assistant = (id: string) => ({ id, role: "assistant" }) as AssistantMessage

describe("timeline model", () => {
  test("undo hides its selected user and suffix while redo restores them", () => {
    const messages: Message[] = [
      user("msg_fa30157fc00125kydn4AhAV5Up"),
      assistant("msg_fa3015891001YKqmBAebsk9DsF"),
      user("msg_0800ad7bf001S6PWTI5wjHdtXS"),
      user("msg_0800b4125001dJoBn2djFCaoph"),
    ]
    const users = selectUserMessages(messages)

    expect(users.map((message) => message.id)).toEqual([
      "msg_fa30157fc00125kydn4AhAV5Up",
      "msg_0800ad7bf001S6PWTI5wjHdtXS",
      "msg_0800b4125001dJoBn2djFCaoph",
    ])
    expect(
      selectVisibleUserMessages(users, "msg_0800ad7bf001S6PWTI5wjHdtXS").map((message) => message.id),
    ).toEqual(["msg_fa30157fc00125kydn4AhAV5Up"])
    const undo = splitAtMessage(users, "msg_0800ad7bf001S6PWTI5wjHdtXS")
    expect(undo.before.at(-1)?.id).toBe("msg_fa30157fc00125kydn4AhAV5Up")
    expect(undo.after[0]?.id).toBe("msg_0800b4125001dJoBn2djFCaoph")
    expect(selectVisibleUserMessages(users)).toBe(users)
  })

  test("waits for an assistant-only load to hydrate its user root", () => {
    expect(isTimelineReady([assistant("msg_2")], true)).toBe(false)
    expect(isTimelineReady([user("msg_1"), assistant("msg_2")], true)).toBe(true)
    expect(isTimelineReady([], false)).toBe(true)
  })

  test("loads exactly one opaque cursor page", async () => {
    let calls = 0
    const anchors: Array<string | boolean> = []

    await loadOlderTimeline({
      sessionID: () => "ses_test",
      more: () => true,
      loading: () => false,
      loadMore: async () => {
        calls += 1
      },
      before: () => anchors.push("before"),
      after: (done) => anchors.push("after", done),
    })

    expect(calls).toBe(1)
    expect(anchors).toEqual(["before", "after", true])
  })

  test("stops when a page adds no raw messages", async () => {
    let calls = 0
    await loadOlderTimeline({
      sessionID: () => "ses_test",
      more: () => true,
      loading: () => false,
      loadMore: async () => {
        calls += 1
      },
    })

    expect(calls).toBe(1)
  })

  test("does not restore an anchor after the session changes", async () => {
    let sessionID = "ses_old"
    let restore = 0

    await loadOlderTimeline({
      sessionID: () => sessionID,
      more: () => true,
      loading: () => false,
      loadMore: async () => {
        sessionID = "ses_new"
      },
      after: () => {
        restore += 1
      },
    })

    expect(restore).toBe(0)
  })

  test("releases the anchor when loading history fails", async () => {
    let restore = 0

    await expect(
      loadOlderTimeline({
        sessionID: () => "ses_test",
        more: () => true,
        loading: () => false,
        loadMore: async () => {
          throw new Error("history failed")
        },
        after: () => {
          restore += 1
        },
      }),
    ).rejects.toThrow("history failed")

    expect(restore).toBe(1)
  })
})
