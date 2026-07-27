// @ts-nocheck

import { Hena } from "@hena/core"
import { ReadTool } from "@hena/core/tools"

const hena = Hena.make({})

hena.tool.add(ReadTool)

hena.tool.add({
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

hena.auth.add({
  provider: "openai",
  type: "api",
  value: process.env.OPENAI_API_KEY,
})

hena.agent.add({
  name: "build",
  permissions: [],
  model: {
    id: "gpt-5-5",
    provider: "openai",
    variant: "xhigh",
  },
})

const sessionID = await hena.session.create({
  agent: "build",
})

hena.subscribe((event) => {
  console.log(event)
})

await hena.session.prompt({
  sessionID,
  text: "hey what is up",
})

await hena.session.prompt({
  sessionID,
  text: "what is up with this",
  files: [
    {
      mime: "image/png",
      uri: "data:image/png;base64,xxxx",
    },
  ],
})

await hena.session.wait()

console.log(await hena.session.messages(sessionID))
