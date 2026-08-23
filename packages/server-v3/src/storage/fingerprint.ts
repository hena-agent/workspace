import { Sync } from "@hena/schema/sync"

export function fingerprint(value: unknown) {
  return new Bun.CryptoHasher("sha256").update(Sync.canonicalJson(value)).digest("hex")
}
