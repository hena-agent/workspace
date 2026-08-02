import { afterEach, expect, test } from "bun:test"
import { Context } from "effect"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances } from "../fixture/fixture"

const context = Context.empty() as Context.Context<unknown>

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

test("session question routes reject an unknown session even with an explicit location", async () => {
  const response = await HttpApiApp.webHandler().handler(
    new Request(
      "http://localhost/api/session/ses_unknown/question?location%5Bdirectory%5D=%2Ftmp%2Fquestion-source",
    ),
    context,
  )

  expect(response.status).toBe(404)
  expect(await response.json()).toEqual(
    expect.objectContaining({ _tag: "SessionNotFoundError", sessionID: "ses_unknown" }),
  )
})
