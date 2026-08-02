import { describe, expect, test } from "bun:test"
import { QuestionV2 } from "@hena/core/question"
import { AbsolutePath } from "@hena/core/schema"
import { SessionV2 } from "@hena/core/session"
import { ownsRequest } from "../src/handlers/question"

describe("QuestionHandler", () => {
  test("validates that the path session owns the request in the explicitly selected location", () => {
    const sessionID = SessionV2.ID.make("ses_owner")
    const requestID = QuestionV2.ID.ascending("que_owned")
    const request: QuestionV2.Request = {
      id: requestID,
      sessionID,
      location: { directory: AbsolutePath.make("/original") },
      questions: [],
    }

    expect(ownsRequest([request], sessionID, requestID)).toBe(true)
    expect(ownsRequest([request], SessionV2.ID.make("ses_other"), requestID)).toBe(false)
    expect(ownsRequest([], sessionID, requestID)).toBe(false)
  })
})
