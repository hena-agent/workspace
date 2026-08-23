const MaxItems = 500
const MaxPayloadBytes = 1024 * 1024 - 16 * 1024

export function pages<Item>(items: readonly Item[]) {
  return items.reduce<Item[][]>((output, item) => {
    const current = output.at(-1)
    if (!current || current.length >= MaxItems || bytes([...current, item]) > MaxPayloadBytes) {
      if (bytes([item]) > MaxPayloadBytes) throw new Error("Stream item exceeds frame limit")
      output.push([item])
      return output
    }
    current.push(item)
    return output
  }, [])
}

function bytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}
