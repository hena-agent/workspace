import { $ } from "bun"

await $`bun ./scripts/copy-icons.ts ${process.env.HENA_CHANNEL ?? "dev"}`

await $`cd ../hena && bun script/build-node.ts`
