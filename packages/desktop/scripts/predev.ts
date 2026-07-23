import { $ } from "bun"

await $`bun ./scripts/copy-icons.ts ${process.env.HENA_AGENT_CHANNEL ?? "dev"}`

await $`cd ../hena-agent && bun script/build-node.ts`
