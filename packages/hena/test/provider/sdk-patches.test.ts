import { expect, test } from "bun:test"
import { createGoogle } from "@ai-sdk/google"
import { createMistral } from "@ai-sdk/mistral"
import { createXai } from "@ai-sdk/xai"

function capture() {
  const requests: unknown[] = []
  return {
    requests,
    fetch: Object.assign(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        requests.push(JSON.parse(String(init?.body)))
        return new Response("Captured request", { status: 400 })
      },
      { preconnect: () => undefined },
    ),
  }
}

test("Google omits assistant turns emptied by reasoning filtering", async () => {
  const transport = capture()
  const model = createGoogle({ apiKey: "test", fetch: transport.fetch })("gemini-2.5-pro")
  await expect(
    model.doGenerate({
      prompt: [
        { role: "user", content: [{ type: "text", text: "Hello" }] },
        {
          role: "assistant",
          content: [{ type: "reasoning", text: "", providerOptions: { google: { thoughtSignature: "signature" } } }],
        },
      ],
    }),
  ).rejects.toMatchObject({ statusCode: 400 })
  expect(transport.requests).toMatchObject([{ contents: [{ role: "user", parts: [{ text: "Hello" }] }] }])
})

test("Mistral retains upstream prompt cache routing", async () => {
  const transport = capture()
  const model = createMistral({ apiKey: "test", fetch: transport.fetch })("mistral-small-latest")
  await expect(
    model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      providerOptions: { mistral: { promptCacheKey: "session-test" } },
    }),
  ).rejects.toMatchObject({ statusCode: 400 })
  expect(transport.requests).toMatchObject([{ prompt_cache_key: "session-test" }])
})

test("xAI Responses preserves inline PDFs and prompt cache routing", async () => {
  const transport = capture()
  const model = createXai({ apiKey: "test", fetch: transport.fetch }).responses("grok-4")
  await expect(
    model.doGenerate({
      prompt: [
        {
          role: "user",
          content: [
            {
              type: "file",
              mediaType: "application/pdf",
              filename: "test.pdf",
              data: { type: "data", data: "JVBERi0xLjQK" },
            },
          ],
        },
      ],
      providerOptions: { xai: { promptCacheKey: "session-test" } },
    }),
  ).rejects.toMatchObject({ statusCode: 400 })
  expect(transport.requests).toMatchObject([
    {
      prompt_cache_key: "session-test",
      input: [
        {
          role: "user",
          content: [
            { type: "input_file", filename: "test.pdf", file_data: "data:application/pdf;base64,JVBERi0xLjQK" },
          ],
        },
      ],
    },
  ])
})
