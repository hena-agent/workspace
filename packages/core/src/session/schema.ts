export * as SessionSchema from "./schema"

import { Session } from "@hena/schema/session"

export const ID = Session.ID
export type ID = typeof ID.Type

export const Info = Session.Info
export type Info = Session.Info

export const defaultTitle = (time: number) => `New session - ${new Date(time).toISOString()}`
export const isDefaultTitle = (title: string) => /^New session - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(title)
