// @ts-nocheck

import { HenaAgent } from "@hena-agent/core"
import { ReadTool } from "@hena-agent/core/tools"

const henaAgent = HenaAgent.make({})

henaAgent.tool.add(ReadTool)

henaAgent.tool.add({
  name: "bash",
  schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to run.",
      },
    },
    required: ["command"],
  },
  execute(input, ctx) {},
})

henaAgent.auth.add({
  provider: "openai",
  type: "api",
  value: process.env.OPENAI_API_KEY,
})

henaAgent.agent.add({
  name: "build",
  permissions: [],
  model: {
    id: "gpt-5-5",
    provider: "openai",
    variant: "xhigh",
  },
})

const sessionID = await henaAgent.session.create({
  agent: "build",
})

henaAgent.subscribe((event) => {
  console.log(event)
})

await henaAgent.session.prompt({
  sessionID,
  text: "hey what is up",
})

await henaAgent.session.prompt({
  sessionID,
  text: "what is up with this",
  files: [
    {
      mime: "image/png",
      uri: "data:image/png;base64,xxxx",
    },
  ],
})

await henaAgent.session.wait()

console.log(await henaAgent.session.messages(sessionID))
