import { expect, test } from "bun:test"
import type { OutputFormat1, QuestionRejected2, QuestionReplied2, SessionStatus2 } from "@hena/sdk/v2/types"

test("retains the published v2 type names and payload shapes", () => {
  const format: OutputFormat1 = { type: "text" }
  const status: SessionStatus2 = {
    id: "evt_status",
    type: "session.status",
    data: { sessionID: "ses_test", status: { type: "idle" } },
  }
  const replied: QuestionReplied2 = {
    id: "evt_replied",
    type: "question.replied",
    data: { sessionID: "ses_test", requestID: "req_test", answers: [["yes"]] },
  }
  const rejected: QuestionRejected2 = {
    id: "evt_rejected",
    type: "question.rejected",
    data: { sessionID: "ses_test", requestID: "req_test" },
  }
  expect(format.type).toBe("text")
  expect(status.data.status.type).toBe("idle")
  expect(replied.data.answers).toEqual([["yes"]])
  expect(rejected.data.requestID).toBe("req_test")
})
