split("\n") as $lines
| (($lines | map(test("^## ")) | index(true)) // ($lines | length)) as $limit
| ($lines[:$limit] | map(test($conventional)) | index(true)) as $start
| if $start == null then
    error("agent-scan returned no conventional issue title")
  else
    {
      title: $lines[$start],
      body: ($lines[$start + 1:] | join("\n") | sub("^\\s+"; ""))
    }
  end
| if (.body | test("\\S")) then . else error("agent-scan returned an empty issue body") end
