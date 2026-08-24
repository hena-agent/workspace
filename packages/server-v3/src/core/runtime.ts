import { AppNodeBuilder } from "@hena/core/effect/app-node-builder"
import { SessionV2 } from "@hena/core/session"
import { SessionExecution } from "@hena/core/session/execution"
import { SessionExecutionLocal } from "@hena/core/session/execution/local"
import { SessionMessage } from "@hena/core/session/message"
import { SessionInput } from "@hena/core/session/input"
import { Effect, ManagedRuntime, Schema } from "effect"
import { LayerNode } from "@hena/core/effect/layer-node"
import { LocationServiceMap } from "@hena/core/location-service-map"
import { FileSystem } from "@hena/core/filesystem"
import { Location } from "@hena/core/location"
import { EventV2 } from "@hena/core/event"
import { PermissionV2 } from "@hena/core/permission"
import { QuestionV2 } from "@hena/core/question"
import { AgentV2 } from "@hena/core/agent"
import { Catalog } from "@hena/core/catalog"
import type { DeltaHub } from "../stream/delta"
import { publishDelta } from "./delta-events"
import { CollectionProjector } from "./collection-projector"
import { MutationTxid } from "./collection-projector"
import type { CoreDomain } from "./domain"
import { OnlineRequestConflict, type OnlineRequestStore } from "./online-requests"
import { Database } from "@hena/core/database/database"
import { sql } from "drizzle-orm"
import { fingerprint } from "../storage/fingerprint"
import { IdempotencyConflict } from "../storage/idempotency"

const encodeSession = Schema.encodeSync(SessionV2.Info)
const encodeAdmitted = Schema.encodeSync(SessionInput.Admitted)

export function createCoreDomain(
  deltaHub?: DeltaHub,
  online?: OnlineRequestStore,
  publishPersisted?: () => void,
  databasePath = Database.path(),
): CoreDomain {
  const locations = new Map<string, Location.Ref>()
  const location = (input: { directory: string; workspaceID?: string }) => {
    const key = JSON.stringify([input.directory, input.workspaceID])
    const cached = locations.get(key)
    if (cached) return cached
    const ref = Schema.decodeUnknownSync(Location.Ref)(input)
    locations.set(key, ref)
    return ref
  }
  const exposedLocation = (input: { directory: string; workspaceID?: string }) =>
    Database.Service.use((database) =>
      Effect.gen(function* () {
        const key = JSON.stringify({
          directory: input.directory,
          ...(input.workspaceID ? { workspaceID: input.workspaceID } : {}),
        })
        const exposed = yield* database.db.get(sql`
          SELECT 1 FROM collection_row
          WHERE collection = 'locations' AND scope_key = '' AND row_key = ${key}
        `)
        if (!exposed) return yield* Effect.fail(new Error("Location is unavailable"))
        return location(input)
      }),
    )
  const runtime = ManagedRuntime.make(
    AppNodeBuilder.build(
      LayerNode.group([SessionV2.node, LocationServiceMap.node, EventV2.node, Database.node, CollectionProjector]),
      [
        [SessionExecution.node, SessionExecutionLocal.node],
        [Database.node, Database.layerFromPath(databasePath)],
      ],
    ),
  )
  const observer =
    deltaHub || online || publishPersisted
      ? runtime.runPromise(
          EventV2.Service.use((events) =>
            events.listen((event) =>
              Effect.sync(() => {
                if (deltaHub) publishDelta(deltaHub, event)
                online?.project(event)
                publishPersisted?.()
              }),
            ),
          ),
        )
      : runtime.runPromise(EventV2.Service.use(() => Effect.void))

  const mutation = <
    Value,
    Error,
    Requirements,
    Response extends { receipt: { outcome: "applied" | "noop" | "exact_retry" } },
  >(input: {
    operation: string
    key: string
    payload: unknown
    execute: Effect.Effect<Value, Error, Requirements>
    response: (
      value: Value,
      receipt: {
        txid: string
        outcome: "applied" | "noop"
        through: { feedId: string; seq: number }
        affectedScopes: Array<{ collection: string; scopeKey: string }>
      },
    ) => Response
    persist?: (response: Response) => unknown
  }) => {
    const notifications: Effect.Effect<void>[] = []
    return Database.Service.use((database) =>
      database.db.transaction((tx) =>
        Effect.gen(function* () {
          const requestFingerprint = fingerprint(input.payload)
          const recorded = yield* tx.get<{ fingerprint: string; response: string }>(sql`
            SELECT fingerprint, response FROM idempotency_record
            WHERE principal = 'local' AND operation = ${input.operation} AND key = ${input.key}
          `)
          if (recorded?.fingerprint !== undefined && recorded.fingerprint !== requestFingerprint)
            return yield* Effect.fail(new IdempotencyConflict())
          if (recorded) {
            const response = JSON.parse(recorded.response) as Response
            return { ...response, receipt: { ...response.receipt, outcome: "exact_retry" as const } }
          }

          const txid = crypto.randomUUID()
          const value = yield* input.execute.pipe(
            Effect.provideService(MutationTxid, txid),
            Effect.provideService(EventV2.DeferredNotifications, (notification) => notifications.push(notification)),
          )
          const changes = yield* tx.all<{ seq: number; collection: string; scope_key: string }>(sql`
            SELECT seq, collection, scope_key FROM collection_change WHERE txid = ${txid} ORDER BY seq
          `)
          const latest = changes.at(-1)
          const feed = yield* tx.get<{ feed_id: string; retained_floor: number }>(sql`
            SELECT feed_id, retained_floor FROM collection_feed WHERE id = 1
          `)
          if (!feed) return yield* Effect.die("collection_feed is missing")
          const applied = changes.length > 0
          const receipt = {
            txid,
            outcome: applied ? ("applied" as const) : ("noop" as const),
            through: {
              feedId: feed.feed_id,
              seq:
                latest?.seq ??
                Math.max(
                  (yield* tx.get<{ seq: number }>(sql`SELECT COALESCE(MAX(seq), 0) AS seq FROM collection_change`))!
                    .seq,
                  feed.retained_floor,
                ),
            },
            affectedScopes: applied
              ? changes
                  .map((change) => ({ collection: change.collection, scopeKey: change.scope_key }))
                  .filter(
                    (scope, index, scopes) =>
                      scopes.findIndex(
                        (item) => item.collection === scope.collection && item.scopeKey === scope.scopeKey,
                      ) === index,
                  )
              : [],
          }
          const response = input.response(value, receipt)
          const persisted = input.persist?.(response) ?? response
          yield* tx.run(sql`
            INSERT INTO idempotency_record (principal, operation, key, fingerprint, response, txid, created_at)
            VALUES ('local', ${input.operation}, ${input.key}, ${requestFingerprint}, ${JSON.stringify(persisted)}, ${txid}, ${Date.now()})
          `)
          return (input.persist ? persisted : response) as Response
        }),
        { behavior: "immediate" },
      ),
    ).pipe(
      Effect.tap(() => Effect.forEach(notifications, (notification) => notification, { discard: true })),
      Effect.tap(() => Effect.sync(() => publishPersisted?.())),
    )
  }

  return {
    ready: () => observer.then(() => {}),
    createSession: (input) =>
      runtime.runPromise(
        mutation({
          operation: "session.create",
          key: input.idempotencyKey,
          payload: input,
          execute: SessionV2.Service.use((service) =>
            Effect.gen(function* () {
              const session = yield* service.create({ id: input.sessionID, location: input.location })
              const admitted = yield* service.prompt({
                id: input.messageID,
                sessionID: session.id,
                prompt: input.prompt,
                delivery: input.delivery,
                resume: false,
              })
              return { session: yield* service.get(session.id), admitted }
            }),
          ),
          response: (result, receipt) => ({
            session: encodeSession(result.session),
            admitted: encodeAdmitted(result.admitted),
            receipt,
          }),
          persist: compactAdmissionResponse,
        }).pipe(
          Effect.tap((response) =>
            SessionV2.Service.use((service) => service.wake(SessionV2.ID.make(response.session.id))),
          ),
        ),
      ),
    admitPrompt: (sessionID, input) =>
      runtime.runPromise(
        mutation({
          operation: "session.prompt",
          key: input.idempotencyKey,
          payload: { sessionID, ...input },
          execute: SessionV2.Service.use((service) =>
            service.prompt({
              id: input.messageID,
              sessionID: SessionV2.ID.make(sessionID),
              prompt: input.prompt,
              delivery: input.delivery,
              resume: false,
            }),
          ),
          response: (admitted, receipt) => ({ admitted: encodeAdmitted(admitted), receipt }),
          persist: compactAdmissionResponse,
        }).pipe(Effect.tap(() => SessionV2.Service.use((service) => service.wake(SessionV2.ID.make(sessionID))))),
      ),
    interrupt: async (sessionID) => {
      await runtime.runPromise(SessionV2.Service.use((service) => service.interrupt(SessionV2.ID.make(sessionID))))
      online?.interrupt(sessionID)
    },
    cancelInput: (sessionID, messageID, input) =>
      runtime.runPromise(
        mutation({
          operation: "session.input.cancel",
          key: input.idempotencyKey,
          payload: { sessionID, messageID, ...input },
          execute: SessionV2.Service.use((service) =>
            service.cancelInput({
              sessionID: SessionV2.ID.make(sessionID),
              messageID: SessionMessage.ID.make(messageID),
              expectedRevision: input.expectedRevision,
            }),
          ),
          response: (revision, receipt) => ({ revision, receipt }),
        }),
      ),
    reorderInputs: (sessionID, input) =>
      runtime.runPromise(
        mutation({
          operation: "session.input.reorder",
          key: input.idempotencyKey,
          payload: { sessionID, ...input },
          execute: SessionV2.Service.use((service) =>
            service.reorderInputs({
              sessionID: SessionV2.ID.make(sessionID),
              messageIDs: input.messageIDs.map((messageID) => SessionMessage.ID.make(messageID)),
              expectedRevision: input.expectedRevision,
            }),
          ),
          response: (revision, receipt) => ({ revision, receipt }),
        }),
      ),
    listFiles: (input) =>
      runtime.runPromise(
        exposedLocation(input).pipe(
          Effect.flatMap((ref) =>
            FileSystem.Service.use((fs) => fs.list({ path: input.path, limit: input.limit ?? 1_000 })).pipe(
              Effect.provide(LocationServiceMap.Service.get(ref)),
            ),
          ),
        ),
      ),
    findFiles: (input) =>
      runtime.runPromise(
        exposedLocation(input).pipe(
          Effect.flatMap((ref) =>
            FileSystem.Service.use((fs) =>
              fs.find({
                query: input.query,
                type: input.type,
                limit: input.limit,
              }),
            ).pipe(Effect.provide(LocationServiceMap.Service.get(ref))),
          ),
        ),
      ),
    replyPermission: async (requestID, input) => {
      if (!online) throw new Error("Online request store is unavailable")
      return online.serialize("permission", requestID, async () => {
        const request = online.request("permission", requestID, input.sessionID, input.nonce)
        if (!request) return resolvedReply(online, "permission", requestID, input.sessionID, input.nonce)
        const result = await runtime.runPromise(
          PermissionV2.Service.use((service) =>
            service.reply({
              requestID: PermissionV2.ID.make(requestID),
              reply: input.reply,
              message: input.message,
            }),
          ).pipe(
            Effect.provide(LocationServiceMap.Service.get(location(request.location))),
            Effect.match({
              onFailure: (error) => ({ success: false as const, error }),
              onSuccess: () => ({ success: true as const }),
            }),
          ),
        )
        if (!result.success) {
          if (result.error instanceof PermissionV2.NotFoundError)
            return resolvedReply(online, "permission", requestID, input.sessionID, input.nonce)
          throw result.error
        }
        return {
          outcome: "applied",
          resolution: online.complete("permission", requestID, {
            sessionID: input.sessionID,
            requestID,
            reply: input.reply,
          }),
        }
      })
    },
    replyQuestion: async (requestID, input) => {
      if (!online) throw new Error("Online request store is unavailable")
      return online.serialize("question", requestID, async () => {
        const request = online.request("question", requestID, input.sessionID, input.nonce)
        if (!request) return resolvedReply(online, "question", requestID, input.sessionID, input.nonce)
        const result = await runtime.runPromise(
          QuestionV2.Service.use((service) =>
            service.reply({
              requestID: QuestionV2.ID.make(requestID),
              answers: input.answers,
            }),
          ).pipe(
            Effect.provide(LocationServiceMap.Service.get(location(request.location))),
            Effect.match({
              onFailure: (error) => ({ success: false as const, error }),
              onSuccess: () => ({ success: true as const }),
            }),
          ),
        )
        if (!result.success) {
          if (result.error instanceof QuestionV2.NotFoundError)
            return resolvedReply(online, "question", requestID, input.sessionID, input.nonce)
          throw result.error
        }
        return {
          outcome: "applied",
          resolution: online.complete("question", requestID, {
            sessionID: input.sessionID,
            requestID,
            answers: input.answers,
          }),
        }
      })
    },
    catalog: (input) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const agents = yield* AgentV2.Service
          const catalog = yield* Catalog.Service
          return {
            agents: yield* agents.all(),
            models: yield* catalog.model.all(),
            providers: yield* catalog.provider.all(),
          }
        }).pipe(Effect.provide(LocationServiceMap.Service.get(location(input)))),
      ),
    dispose: async () => {
      const unsubscribe = await observer
      if (unsubscribe) await Effect.runPromise(unsubscribe)
      await runtime.dispose()
    },
  }
}

function resolvedReply(
  online: OnlineRequestStore,
  kind: "permission" | "question",
  requestID: string,
  sessionID: string,
  nonce: string,
) {
  const resolution = online.resolution(kind, requestID, sessionID, nonce)
  if (!resolution) throw new OnlineRequestConflict(`${kind} request does not match a resolved request`)
  return { outcome: "already_resolved" as const, resolution }
}

function compactAdmissionResponse(response: unknown) {
  if (typeof response !== "object" || response === null || !("admitted" in response)) return response
  const admitted = response.admitted
  if (typeof admitted !== "object" || admitted === null || !("prompt" in admitted)) return response
  const prompt = admitted.prompt
  if (typeof prompt !== "object" || prompt === null || !("files" in prompt) || !Array.isArray(prompt.files))
    return response
  return {
    ...response,
    admitted: {
      ...admitted,
      prompt: {
        ...prompt,
        files: prompt.files.map((file) =>
          typeof file === "object" && file !== null && "uri" in file && typeof file.uri === "string"
            ? { ...file, uri: "" }
            : file,
        ),
      },
    },
  }
}
