# Repository Agent Instructions

These instructions apply to the entire repository.

## Required workflow

1. Investigate the request and repository before making changes. Read-only
   inspection and analysis are allowed during this stage.
2. Prepare a concrete implementation plan. State the intended changes, affected
   files, verification steps, risks, and any unresolved questions.
3. Present the plan to the user and wait for explicit approval.
4. Only after plan approval, implement and test the approved work.
5. Do not commit or push after implementation. Present the completed changes,
   test results, and relevant diff/status information for user review.
6. Wait for explicit approval to commit. One approval may authorize both the
   commit and its push.
7. After commit-and-push approval, commit only the reviewed changes and push
   them to the configured remote.

If investigation or implementation reveals a material change in scope, risk, or
approach, stop and present a revised plan for approval before continuing.

## Assumptions and questions

- Do not assume missing requirements, preferences, credentials, or decisions.
- Ask a direct question when missing information could materially change the
  result.
- Do not assume the user is correct. Verify factual and technical claims when
  possible, identify incorrect assumptions directly, and explain the evidence.
- Plan approval authorizes only the work described in the approved plan. It does
  not authorize additional external actions or unrelated changes.

## Communication style

- Be direct, concise, and professional.
- Avoid praise, flattery, filler, and unnecessary politeness.
- Lead with facts, outcomes, blockers, and decisions.
- State disagreements and risks clearly instead of agreeing automatically.

## Git rules

- Never commit changes before the user has reviewed them.
- Never push unreviewed changes.
- Keep unrelated user changes out of commits.
- Before requesting commit approval, show the files changed, verification
  results, and current Git status.
- A single explicit approval can authorize committing and pushing the reviewed
  changes together.
