# Repository Agent Instructions

These instructions apply to the entire repository.

## Required workflow

1. Investigate the request and repository before making changes. Read-only inspection and analysis
   are allowed during this stage.
2. Prepare a concrete implementation plan. State the intended changes, affected files, verification
   steps, risks, and any unresolved questions.
3. Present the plan to the user and wait for explicit approval.
4. Only after plan approval, implement and test the approved work.
5. Do not commit or push after implementation. Present the completed changes, test results, and
   relevant diff/status information for user review.
6. Wait for explicit approval to commit. One approval may authorize both the commit and its push.
7. After commit-and-push approval, commit only the reviewed changes and push them to the configured
   remote.

If investigation or implementation reveals a material change in scope, risk, or approach, stop and
present a revised plan for approval before continuing.

## Assumptions and questions

- Do not assume missing requirements, preferences, credentials, or decisions.
- Ask a direct question when missing information could materially change the result.
- Do not assume the user is correct. Verify factual and technical claims when possible, identify
  incorrect assumptions directly, and explain the evidence.
- Plan approval authorizes only the work described in the approved plan. It does not authorize
  additional external actions or unrelated changes.

## Communication style

- Be direct, concise, and professional.
- Avoid praise, flattery, filler, and unnecessary politeness.
- Lead with facts, outcomes, blockers, and decisions.
- State disagreements and risks clearly instead of agreeing automatically.

## Codex task routing and usage efficiency

Before exploring the repository, running commands, or changing files for each new top-level task,
first output exactly one short line containing the model and reasoning recommendation:
`ROUTING: <model + reasoning> | CONTEXT: <CONTINUE | COMPACT | NEW CHAT> | <reason>`. Do not repeat
it for a clear follow-up. Do not add a plan or explanation to that routing message. If the current
configuration is materially unsuitable, output the recommendation and stop so the user can switch
models before any task work begins.

Choose the least costly configuration likely to finish reliably: Luna (Low/Medium) for searches,
documentation, configuration, and focused mechanical changes; Terra (Medium) for normal multi-file
development, debugging, and refactoring; Sol (Medium) for substantial, architecture-sensitive, or
multi-system work, including when cheaper models failed; Astra (Low/Medium) for genuinely hard,
unfamiliar, broad, or unclear problems. If names change, apply the same economical-to-strongest
progression. Use Low for straightforward work, Medium by default for meaningful development, and
High only for a concrete need or failed lower reasoning. Do not recommend Fast unless speed matters
more than allowance, or a more expensive model for marginal quality.

When the current configuration is known and materially unsuitable, recommend a cheaper or stronger
one and stop for `/model`. If it is suitable, continue. If it is unknown, do not invent it; state a
recommendation and continue unless switching clearly requires user action.

Use CONTINUE for a focused continuation. Use COMPACT when the same objective needs useful context
but accumulated logs, diffs, or completed work make raw history wasteful; stop and say only:
`Run /compact, then continue this task.` Use NEW CHAT only when the prior objective is complete and
the new request is substantially unrelated; stop before implementation. Do not use difficulty alone
to select NEW CHAT or claim a context percentage without an exact measure.

Start with directly relevant files and search rather than broad exploration. Consult applicable
skills, avoid rereading understood files and generated/vendor content, use targeted checks during
work and broader validation before completion, reuse existing scripts, avoid unrelated refactors,
and keep progress and logs concise.

## Code quality rules

- Follow `.editorconfig`, `.prettierrc.json`, and `eslint.config.mjs` for every applicable file. Do
  not introduce a conflicting local style.
- Run `pnpm check` after implementing changes and before presenting them for review.
- Use `pnpm check:fix` when automatic formatting or lint fixes are needed, then run `pnpm check`
  again.
- Do not bypass Git hooks with `--no-verify`.
- Do not disable lint rules, add ignore patterns, or weaken formatting checks without including that
  change in an approved plan.
- Report formatting or lint failures directly. Do not claim verification passed unless the command
  completed successfully.

## Git rules

- Never commit changes before the user has reviewed them.
- Never push unreviewed changes.
- Keep unrelated user changes out of commits.
- Before requesting commit approval, show the files changed, verification results, and current Git
  status.
- A single explicit approval can authorize committing and pushing the reviewed changes together.
