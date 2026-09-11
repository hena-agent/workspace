#!/usr/bin/env bun
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

import { $ } from "bun"
import path from "path"

import { createClient } from "@hey-api/openapi-ts"

const hena = path.resolve(dir, "../../hena")
const openapi = path.resolve(dir, "../openapi.json")

await $`bun dev generate > ${openapi}`.cwd(hena)

const document = (await Bun.file(openapi).json()) as {
  components?: { schemas?: Record<string, unknown> }
  [key: string]: unknown
}
const schemas = document.components?.schemas
if (schemas) {
  const reachable = new Set<string>()
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (typeof value !== "object" || value === null) return
    for (const [key, child] of Object.entries(value)) {
      if (key === "$ref" && typeof child === "string" && child.startsWith("#/components/schemas/")) {
        const name = child.slice("#/components/schemas/".length)
        if (reachable.has(name)) continue
        reachable.add(name)
        visit(schemas[name])
      } else {
        visit(child)
      }
    }
  }
  visit({ ...document, components: { ...document.components, schemas: undefined } })
  for (const name of Object.keys(schemas)) {
    if (/^SessionNext\w+1$/.test(name) && !reachable.has(name)) delete schemas[name]
  }
  await Bun.write(openapi, JSON.stringify(document))
}

await createClient({
  input: openapi,
  output: {
    path: "./src/v2/gen",
    tsConfigPath: path.join(dir, "tsconfig.json"),
    clean: true,
  },
  plugins: [
    {
      name: "@hey-api/typescript",
      exportFromIndex: false,
    },
    {
      name: "@hey-api/sdk",
      operations: { strategy: "single", containerName: "HenaClient", methods: "instance" },
      exportFromIndex: false,
      auth: false,
      paramsStructure: "flat",
    },
    {
      name: "@hey-api/client-fetch",
      exportFromIndex: false,
      baseUrl: "http://localhost:4096",
    },
  ],
})

const generatedTypes = await Bun.file("./src/v2/gen/types.gen.ts").text()
if (/export type SessionNext\w+1 =/.test(generatedTypes)) {
  throw new Error("Session history generated duplicate Session event variants")
}
// These collision-numbered names shipped from @hena/sdk/v2/types. Preserve
// imports even when Effect deduplicates the underlying schema differently.
const aliases = Object.entries({
  OutputFormat1: "OutputFormat",
  SessionStatus2: "SessionStatus1",
  QuestionReplied2: "QuestionReplied1",
  QuestionRejected2: "QuestionRejected1",
}).flatMap(([name, target]) => {
  if (new RegExp(`export type ${name}\\b`).test(generatedTypes)) return []
  if (!new RegExp(`export type ${target}\\b`).test(generatedTypes)) {
    throw new Error(`Cannot preserve public SDK type ${name}: missing ${target}`)
  }
  return [`export type ${name} = ${target}`]
})
await Bun.write("./src/v2/gen/types.gen.ts", `${generatedTypes}\n${aliases.join("\n")}\n`)

await $`bun prettier --write src/v2 ${openapi}`
await $`rm -rf dist`
await $`bunx --package @typescript/native tsc`
