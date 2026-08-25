def nonblank($message):
  if type == "string" and test("\\S") then . else error($message) end;

def final_text:
  [.[] | select(.type == "text") | .part.text]
  | last
  | nonblank("OpenCode command returned no final text");

def completed_review:
  if ([.[] | select(.type == "error") | .error.data.isRetryable] | last) != true then
    error("OpenCode command did not end with a retryable provider error")
  else
    [
      .[]
      | select(
          .type == "tool_use"
          and .part.tool == "task"
          and .part.state.status == "completed"
          and .part.state.input.command == "review"
        )
      | .part.state.output
      | select(
          type == "string"
          and test("^<task[^>]*>\\n<task_result>\\n[\\s\\S]*\\n</task_result>\\n</task>$")
        )
      | sub("^<task[^>]*>\\n<task_result>\\n"; "")
      | sub("\\n</task_result>\\n</task>$"; "")
    ]
    | last
    | nonblank("OpenCode command returned no completed review task")
  end;

if $operation == "final-text" then
  final_text
elif $operation == "completed-review" then
  completed_review
else
  error("unsupported review extraction operation: " + $operation)
end
