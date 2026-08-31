import { Option, Schema } from "effect"

const decodeEmbeddedUI = Schema.decodeUnknownOption(
  Schema.Struct({ default: Schema.Record(Schema.String, Schema.String) }),
)
let embeddedUIPromise: Promise<Record<string, string> | null> | undefined

export function embeddedUI(disabled: boolean) {
  if (disabled) return Promise.resolve(null)
  return (embeddedUIPromise ??=
    // @ts-expect-error generated and embedded when compiling the release binary
    import("hena-web-ui.gen.ts")
      .then((module) => Option.getOrNull(decodeEmbeddedUI(module).pipe(Option.map((value) => value.default))))
      .catch(() => null))
}
