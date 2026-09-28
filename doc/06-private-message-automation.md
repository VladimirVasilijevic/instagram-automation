# Private-message automation activation

## Implemented behavior

One automation is configured for one recent Instagram post. Its trigger must be a hashtag without
spaces. Matching trims surrounding spaces and ignores capitalization, but otherwise requires the
whole comment to equal the trigger. Only top-level comments from another account are eligible.

The owner chooses one delivery mode:

- **Public reply only** sends one reply below the matching comment.
- **Private DM only** sends one private reply authorized by that comment.
- **Public reply and private DM** creates and tracks both deliveries independently.

Each `(Instagram comment ID, delivery channel)` pair is unique in the database. Retries use the
Milestone 8 lease policy. A timeout or other ambiguous result becomes `uncertain` and is not retried
automatically because doing so could duplicate a message.

## Deployment order

1. Review the code and verification results.
2. Apply `db/migrations/0004_multichannel_replies.sql` in Supabase SQL Editor.
3. Commit and push only after explicit approval.
4. Wait for the Vercel production deployment to become ready.
5. Open the app, reload the automation editor, and save the desired mode and message text.
6. Run the manual acceptance cases in the Milestone 9 plan.

The migration preserves existing automations as **Public reply only** and preserves existing
execution records as public deliveries. It also installs a compatibility trigger that snapshots the
automation's public reply when the previous production version inserts an execution without the new
`message_text` column. This makes applying the migration before deploying the application safe.

## Review log and known external risks

No code can prove Meta production acceptance without a real comment from a different Instagram
account. During the first private test, review the Activity channel status and sanitized Vercel log.

Verification finding on September 28, 2026: the configured Supabase database does not yet have
migration `0004`. The integration test applied the exact migration inside a rollback-only
transaction, exercised public/private persistence, grouped activity, and duplicate prevention, and
also verified the previous production insert shape. Both database cases passed. The transaction
rolled the schema and test rows back. Production still requires the normal migration command before
deployment.

| Risk                                                                   | Expected detection                                                                  | Action                                                                                                             |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Token lacks permission accepted by Meta's private-reply endpoint       | Private channel becomes failed or retry pending with a safe provider classification | Capture the safe error code/status, then decide whether reconnecting with an additional reviewed scope is required |
| Comment is too old or already used for a private reply                 | Meta rejects only the private channel                                               | Use a new top-level comment; do not retry the same private reply manually                                          |
| Test comment is a reply or belongs to the connected owner              | No execution is created                                                             | Test with a new top-level comment from another account                                                             |
| Provider accepts a request but the connection ends before confirmation | Channel becomes `Review needed`                                                     | Inspect Instagram before any manual resend to avoid a duplicate                                                    |
| Database migration was not applied before deployment                   | API requests fail with sanitized storage errors                                     | Apply migration `0004`, then retry loading and saving                                                              |

Do not paste access tokens, private message content, comment content, or raw Meta response bodies
into issue reports. Record only the time, selected delivery mode, Activity status, safe application
error code, and sanitized Vercel log context.
