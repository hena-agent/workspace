split("\n") as $lines
| [
    range(0; $lines | length)
    | select($lines[.] | test("^(feat|fix|docs|chore|refactor|test)(\\([^)]+\\))?: .+"))
  ]
| first as $start
| if $start == null then
    error("agent-scan returned no conventional issue title")
  else
    $lines[$start:] | join("\n")
  end
