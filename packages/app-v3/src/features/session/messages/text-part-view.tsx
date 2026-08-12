import type { TextPart } from "@/lib/types"

// A single-purpose seam: dummy data renders as plain text today, but every
// caller goes through this component so swapping in Streamdown later (per
// the web-ui spec) touches one file, not every message row.
export function TextPartView({ part }: { part: TextPart }) {
  return <p className="text-sm whitespace-pre-wrap">{part.text}</p>
}
