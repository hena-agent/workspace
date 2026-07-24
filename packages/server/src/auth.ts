export * as ServerAuth from "./auth"

import { Flag } from "@hena/core/flag/flag"
import { Context, Layer, Option, Redacted } from "effect"

export type Credentials = {
  password?: string
  username?: string
}

export type DecodedCredentials = {
  readonly username: string
  readonly password: Redacted.Redacted
}

export type Info = {
  readonly password: Option.Option<string>
  readonly username: string
}

export class Config extends Context.Service<Config, Info>()("@hena/ServerAuthConfig") {
  static configLayer(input: Info) {
    return Layer.succeed(this, this.of(input))
  }

  static get layer() {
    return Layer.succeed(
      this,
      Config.of({
        password: Option.fromNullishOr(Flag.HENA_SERVER_PASSWORD),
        username: Flag.HENA_SERVER_USERNAME ?? "hena",
      }),
    )
  }
}

export function required(config: Info) {
  return Option.isSome(config.password) && config.password.value !== ""
}

export function authorized(credentials: DecodedCredentials, config: Info) {
  return (
    Option.isSome(config.password) &&
    credentials.username === config.username &&
    Redacted.value(credentials.password) === config.password.value
  )
}

export function header(credentials?: Credentials) {
  const password = credentials?.password ?? Flag.HENA_SERVER_PASSWORD
  if (!password) return undefined

  return `Basic ${Buffer.from(`${credentials?.username ?? Flag.HENA_SERVER_USERNAME ?? "hena"}:${password}`).toString("base64")}`
}

export function headers(credentials?: Credentials) {
  const authorization = header(credentials)
  if (!authorization) return undefined
  return { Authorization: authorization }
}
