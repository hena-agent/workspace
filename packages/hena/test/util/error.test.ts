import { describe, expect, test } from "bun:test"
import { NamedError } from "@hena/core/util/error"
import { MessageError } from "../../src/session/message-error"
import { errorData, errorFormat, errorMessage } from "../../src/util/error"

describe("util.error", () => {
  test("schema-backed named errors are real NamedError instances", () => {
    const error = new MessageError.AuthError({ providerID: "anthropic", message: "boom" })

    expect(error).toBeInstanceOf(NamedError)
    expect(error.toObject()).toEqual({ name: "ProviderAuthError", data: { providerID: "anthropic", message: "boom" } })
  })

  test("named errors without fields serialize data", () => {
    expect(new MessageError.OutputLengthError({}).toObject()).toEqual({ name: "MessageOutputLengthError", data: {} })
  })

  test("formats native Error instances", () => {
    const error = new Error("boom")
    expect(errorMessage(error)).toBe("boom")
    expect(errorFormat(error)).toContain("boom")
    expect(errorData(error)).toMatchObject({ type: "Error", message: "boom" })
  })

  test("extracts messages from record-like values", () => {
    expect(errorMessage({ message: "bad input" })).toBe("bad input")
    expect(errorMessage({ data: { message: "nested" } })).toBe("nested")
  })

  test("formats opaque objects", () => {
    expect(errorFormat({})).toContain("no message")

    class OpaqueError {}
    const error = new OpaqueError()
    Object.defineProperty(error, "secret", { value: "hidden", enumerable: false })
    expect(errorFormat(error)).toContain("OpaqueError")
  })
})
