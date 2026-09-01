export * as SessionTitle from "./title"

import { LLM, LLMError, LLMEvent, Message, type LLMRequest, type Model } from "@hena/llm"
import { Cause, DateTime, Effect, Scope, Stream } from "effect"
import { AgentV2 } from "../../agent"
import type { EventV2 } from "../../event"
import type { Location } from "../../location"
import { SessionEvent } from "../event"
import { SessionMessage } from "../message"
import { SessionSchema } from "../schema"
import type { SessionStore } from "../store"
import type { SessionRunnerModel } from "./model"
import { toLLMMessages } from "./to-llm-message"

type Dependencies = {
  readonly agents: AgentV2.Interface
  readonly events: EventV2.Interface
  readonly llm: {
    readonly stream: (request: LLMRequest) => Stream.Stream<LLMEvent, LLMError>
  }
  readonly location: Location.Interface
  readonly models: SessionRunnerModel.Interface
  readonly scope: Scope.Scope
  readonly store: SessionStore.Interface
}

export const make = (dependencies: Dependencies) => {
  const active = new Set<SessionSchema.ID>()

  const generate = Effect.fn("SessionTitle.generate")(function* (
    session: SessionSchema.Info,
    context: ReadonlyArray<SessionMessage.Message>,
    model: Model,
  ) {
    if (session.parentID || !SessionSchema.isDefaultTitle(session.title) || active.has(session.id)) return
    const users = context.filter((message) => message.type === "user")
    if (users.length !== 1) return
    const agent = yield* dependencies.agents.get(AgentV2.ID.make("title"))
    if (!agent) return
    active.add(session.id)
    yield* Effect.gen(function* () {
      const titleModel = agent.model ? yield* dependencies.models.resolve({ ...session, model: agent.model }) : model
      const response = yield* dependencies.llm
        .stream(
          LLM.request({
            model: titleModel,
            system: agent.system,
            messages: [
              Message.user("Generate a title for this conversation:\n"),
              ...toLLMMessages(users, titleModel),
            ],
            // Muse rejects toolChoice "none" and can spend small output limits entirely on reasoning.
            tools: [],
          }),
        )
        .pipe(
          Stream.filter(LLMEvent.is.textDelta),
          Stream.map((event) => event.text),
          Stream.mkString,
        )
      const cleaned = response
        .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
        .split("\n")
        .map((line) => line.trim())
        .find(Boolean)
      if (!cleaned) return
      const current = yield* dependencies.store.get(session.id)
      if (
        !current ||
        current.location.directory !== dependencies.location.directory ||
        current.location.workspaceID !== dependencies.location.workspaceID ||
        !SessionSchema.isDefaultTitle(current.title)
      )
        return
      yield* dependencies.events.publish(SessionEvent.TitleUpdated, {
        sessionID: session.id,
        timestamp: yield* DateTime.now,
        title: cleaned.length > 100 ? `${cleaned.slice(0, 97)}...` : cleaned,
      })
    }).pipe(
      Effect.timeout("30 seconds"),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.logWarning("failed to generate session title", { cause: Cause.pretty(cause) }),
      ),
      Effect.ensuring(Effect.sync(() => active.delete(session.id))),
    )
  })

  const start = (session: SessionSchema.Info, context: ReadonlyArray<SessionMessage.Message>, model: Model) =>
    generate(session, context, model).pipe(Effect.forkIn(dependencies.scope, { startImmediately: true }))

  return { generate, start }
}
