{
  failed: [
    .[]
    | select(
        (.__typename == "CheckRun" and .status == "COMPLETED" and (.conclusion | IN("SUCCESS", "NEUTRAL", "SKIPPED") | not))
        or (.__typename == "StatusContext" and (.state | IN("FAILURE", "ERROR")))
      )
    | (.name // .context)
  ],
  pending: [
    .[]
    | select(
        (.__typename == "CheckRun" and .status != "COMPLETED")
        or (.__typename == "StatusContext" and (.state | IN("PENDING", "EXPECTED")))
      )
  ] | length
}
