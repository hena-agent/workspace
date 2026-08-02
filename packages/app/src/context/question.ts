import type { QuestionRequest } from "@hena/sdk/v2/client"

export type BrowserQuestionLocation = { readonly directory: string; readonly workspaceID?: string }

type CurrentQuestionRequest = {
  readonly id: string
  readonly sessionID: string
  readonly location: BrowserQuestionLocation
  readonly questions: ReadonlyArray<{
    readonly question: string
    readonly header: string
    readonly options: ReadonlyArray<{ readonly label: string; readonly description: string }>
    readonly multiple?: boolean
    readonly custom?: boolean
  }>
  readonly tool?: { readonly messageID: string; readonly callID: string }
  readonly action?: { readonly type: "attach-folder"; readonly projectID: string }
}

export type BrowserQuestionRequest =
  | (QuestionRequest & { readonly protocol: "legacy"; readonly location: BrowserQuestionLocation })
  | (CurrentQuestionRequest & { readonly protocol: "current" })

export function legacyQuestion(request: QuestionRequest, directory: string): BrowserQuestionRequest {
  return { ...request, protocol: "legacy", location: { directory } }
}

export function currentQuestion(request: CurrentQuestionRequest): BrowserQuestionRequest {
  return { ...request, protocol: "current" }
}

export function locationHeaders(location: BrowserQuestionLocation) {
  return {
    "x-hena-directory": encodeURIComponent(location.directory),
    ...(location.workspaceID ? { "x-hena-workspace": location.workspaceID } : {}),
  }
}
