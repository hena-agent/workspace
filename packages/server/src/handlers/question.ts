import { QuestionV2 } from "@hena/core/question"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { QuestionNotFoundError } from "@hena/protocol/errors"
import { response } from "../location"

function missingRequest(id: QuestionV2.ID) {
  return new QuestionNotFoundError({ requestID: id, message: `Question request not found: ${id}` })
}

export function ownsRequest(
  requests: ReadonlyArray<QuestionV2.Request>,
  sessionID: QuestionV2.Request["sessionID"],
  requestID: QuestionV2.ID,
) {
  return requests.some((request) => request.id === requestID && request.sessionID === sessionID)
}

export const QuestionHandler = HttpApiBuilder.group(Api, "server.question", (handlers) =>
  Effect.gen(function* () {
    const withOwnedQuestion = Effect.fnUntraced(function* <A, E>(
      sessionID: QuestionV2.Request["sessionID"],
      requestID: QuestionV2.ID,
      use: (question: QuestionV2.Interface) => Effect.Effect<A, E>,
    ) {
      const question = yield* QuestionV2.Service
      if (!ownsRequest(yield* question.list(), sessionID, requestID)) return yield* missingRequest(requestID)
      return yield* use(question)
    })

    return handlers
      .handle(
        "question.request.list",
        Effect.fn(function* () {
          return yield* response((yield* QuestionV2.Service).list())
        }),
      )
      .handle(
        "session.question.list",
        Effect.fn(function* (ctx) {
          const requests = yield* (yield* QuestionV2.Service).list()
          return { data: requests.filter((request) => request.sessionID === ctx.params.sessionID) }
        }),
      )
      .handle(
        "session.question.reply",
        Effect.fn(function* (ctx) {
          yield* withOwnedQuestion(ctx.params.sessionID, ctx.params.requestID, (question) =>
            question
              .reply({ requestID: ctx.params.requestID, answers: ctx.payload.answers })
              .pipe(Effect.catchTag("QuestionV2.NotFoundError", () => missingRequest(ctx.params.requestID))),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "session.question.reject",
        Effect.fn(function* (ctx) {
          yield* withOwnedQuestion(ctx.params.sessionID, ctx.params.requestID, (question) =>
            question
              .reject(ctx.params.requestID)
              .pipe(Effect.catchTag("QuestionV2.NotFoundError", () => missingRequest(ctx.params.requestID))),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
