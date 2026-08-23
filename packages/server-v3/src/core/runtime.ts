import { AppNodeBuilder } from "@hena/core/effect/app-node-builder"
import { SessionV2 } from "@hena/core/session"
import { SessionExecution } from "@hena/core/session/execution"
import { SessionExecutionLocal } from "@hena/core/session/execution/local"
import { SessionMessage } from "@hena/core/session/message"
import { Effect, ManagedRuntime, Schema, Stream } from "effect"
import { LayerNode } from "@hena/core/effect/layer-node"
import { LocationServiceMap } from "@hena/core/location-service-map"
import { FileSystem } from "@hena/core/filesystem"
import { Location } from "@hena/core/location"
import { RelativePath } from "@hena/core/schema"
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
import type { OnlineRequestStore } from "./online-requests"
import { Database } from "@hena/core/database/database"
import { sql } from "drizzle-orm"
import { fingerprint } from "../storage/fingerprint"
import { IdempotencyConflict } from "../storage/idempotency"

export function createCoreDomain(
  deltaHub?: DeltaHub,
  online?: OnlineRequestStore,
  publishPersisted?: () => void,
): CoreDomain {
  const runtime = ManagedRuntime.make(
    AppNodeBuilder.build(
      LayerNode.group([SessionV2.node, LocationServiceMap.node, EventV2.node, Database.node, CollectionProjector]),
      [[SessionExecution.node, SessionExecutionLocal.node]],
    ),
  )
  if (deltaHub || online || publishPersisted)
    runtime.runFork(
      EventV2.Service.use((events) =>
        events.all().pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => {
              if (deltaHub) publishDelta(deltaHub, event)
              online?.project(event)
              publishPersisted?.()
            }),
          ),
        ),
      ),
    )

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
    targets: (value: Value) => Array<{ collection: string; scopeKey: string; rowKey?: string }>
    response: (
      value: Value,
      receipt: {
        txid: string
        outcome: "applied"
        through: { feedId: string; seq: number }
        affectedScopes: Array<{ collection: string; scopeKey: string }>
      },
    ) => Response
  }) =>
    Database.Service.use((database) =>
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
          const value = yield* input.execute.pipe(Effect.provideService(MutationTxid, txid))
          const targets = input.targets(value)
          const changes = yield* Effect.forEach(targets, (target) =>
            target.rowKey
              ? tx.get<{ seq: number }>(sql`
                  SELECT seq FROM collection_change
                  WHERE collection = ${target.collection} AND scope_key = ${target.scopeKey} AND row_key = ${target.rowKey}
                  ORDER BY seq DESC LIMIT 1
                `)
              : tx.get<{ seq: number }>(sql`
                  SELECT seq FROM collection_change
                  WHERE collection = ${target.collection} AND scope_key = ${target.scopeKey}
                  ORDER BY seq DESC LIMIT 1
                `),
          )
          const latest = changes
            .filter((change): change is { seq: number } => change !== undefined)
            .sort((left, right) => right.seq - left.seq)[0]
          const feed = yield* tx.get<{ feed_id: string }>(sql`SELECT feed_id FROM collection_feed WHERE id = 1`)
          if (!feed) return yield* Effect.die("collection_feed is missing")
          const receipt = {
            txid,
            outcome: "applied" as const,
            through: {
              feedId: feed.feed_id,
              seq:
                latest?.seq ??
                (yield* tx.get<{ seq: number }>(sql`SELECT COALESCE(MAX(seq), 0) AS seq FROM collection_change`))!.seq,
            },
            affectedScopes: targets
              .map((target) => ({ collection: target.collection, scopeKey: target.scopeKey }))
              .filter(
                (scope, index, scopes) =>
                  scopes.findIndex(
                    (item) => item.collection === scope.collection && item.scopeKey === scope.scopeKey,
                  ) === index,
              ),
          }
          const response = input.response(value, receipt)
          yield* tx.run(sql`
            INSERT INTO idempotency_record (principal, operation, key, fingerprint, response, txid, created_at)
            VALUES ('local', ${input.operation}, ${input.key}, ${requestFingerprint}, ${JSON.stringify(response)}, ${txid}, ${Date.now()})
          `)
          return response
        }),
      ),
    ).pipe(Effect.tap(() => Effect.sync(() => publishPersisted?.())))

  return {
    ready: () => runtime.runPromise(EventV2.Service.use(() => Effect.void)),
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
              })
              return { session, admitted }
            }),
          ),
          targets: (result) => [
            { collection: "sessions", scopeKey: "", rowKey: result.session.id },
            { collection: "sessionInputs", scopeKey: result.session.id, rowKey: result.admitted.id },
          ],
          response: (result, receipt) => ({ ...result, receipt }),
        }),
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
            }),
          ),
          targets: (admitted) => [{ collection: "sessionInputs", scopeKey: admitted.sessionID, rowKey: admitted.id }],
          response: (admitted, receipt) => ({ admitted, receipt }),
        }),
      ),
    interrupt: (sessionID) =>
      runtime.runPromise(SessionV2.Service.use((service) => service.interrupt(SessionV2.ID.make(sessionID)))),
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
          targets: () => [{ collection: "sessions", scopeKey: "", rowKey: sessionID }],
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
          targets: () => [{ collection: "sessions", scopeKey: "", rowKey: sessionID }],
          response: (revision, receipt) => ({ revision, receipt }),
        }),
      ),
    listFiles: (input) =>
      runtime.runPromise(
        FileSystem.Service.use((fs) => fs.list({ path: input.path ? RelativePath.make(input.path) : undefined })).pipe(
          Effect.provide(LocationServiceMap.Service.get(location(input))),
        ),
      ),
    findFiles: (input) =>
      runtime.runPromise(
        FileSystem.Service.use((fs) =>
          fs.find({
            query: input.query,
            type: input.type,
            limit: input.limit ? parseLimit(input.limit) : undefined,
          }),
        ).pipe(Effect.provide(LocationServiceMap.Service.get(location(input)))),
      ),
    replyPermission: async (requestID, input) => {
      if (!online) throw new Error("Online request store is unavailable")
      if (!online.pending("permission", requestID, input.sessionID, input.nonce))
        return { outcome: "already_resolved", resolution: online.authoritative("permission", requestID) }
      const result = await runtime.runPromise(
        PermissionV2.Service.use((service) =>
          service.reply({
            requestID: PermissionV2.ID.make(requestID),
            reply: input.reply,
            message: input.message,
          }),
        ).pipe(
          Effect.provide(LocationServiceMap.Service.get(location(input.location))),
          Effect.match({
            onFailure: (error) => ({ success: false as const, error }),
            onSuccess: () => ({ success: true as const }),
          }),
        ),
      )
      if (!result.success) {
        if (result.error instanceof PermissionV2.NotFoundError)
          return { outcome: "already_resolved", resolution: online.authoritative("permission", requestID) }
        throw result.error
      }
      return {
        outcome: "applied",
        resolution: online.resolution("permission", requestID) ?? {
          sessionID: input.sessionID,
          requestID,
          reply: input.reply,
        },
      }
    },
    replyQuestion: async (requestID, input) => {
      if (!online) throw new Error("Online request store is unavailable")
      if (!online.pending("question", requestID, input.sessionID, input.nonce))
        return { outcome: "already_resolved", resolution: online.authoritative("question", requestID) }
      const result = await runtime.runPromise(
        QuestionV2.Service.use((service) =>
          service.reply({
            requestID: QuestionV2.ID.make(requestID),
            answers: input.answers,
          }),
        ).pipe(
          Effect.provide(LocationServiceMap.Service.get(location(input.location))),
          Effect.match({
            onFailure: (error) => ({ success: false as const, error }),
            onSuccess: () => ({ success: true as const }),
          }),
        ),
      )
      if (!result.success) {
        if (result.error instanceof QuestionV2.NotFoundError)
          return { outcome: "already_resolved", resolution: online.authoritative("question", requestID) }
        throw result.error
      }
      return {
        outcome: "applied",
        resolution: online.resolution("question", requestID) ?? {
          sessionID: input.sessionID,
          requestID,
          answers: input.answers,
        },
      }
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
    dispose: () => runtime.dispose(),
  }
}

function location(input: { directory: string; workspaceID?: string }) {
  return Schema.decodeUnknownSync(Location.Ref)(input)
}

function parseLimit(input: string) {
  const limit = Number(input)
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new Error("limit must be between 1 and 1000")
  return limit
}
