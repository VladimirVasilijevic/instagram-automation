# Private-message automation activation

## Implemented behavior

One automation is configured for one recent Instagram post. Its trigger can match the complete
trimmed comment, a complete word or hashtag contained in the comment, or every eligible top-level
comment. Text matching ignores capitalization. Replies to comments and comments from the connected
account remain ineligible in every mode.

The owner chooses one delivery mode:

- **Public reply only** sends one reply below the matching comment.
- **Private DM only** sends one private reply authorized by that comment.
- **Public reply and private DM** creates and tracks both deliveries independently.

Each `(Instagram comment ID, delivery channel)` pair is unique in the database. Retries use the
Milestone 8 lease policy. A timeout or other ambiguous result becomes `uncertain` and is not retried
automatically because doing so could duplicate a message.

## Deployment order

1. Review the code and verification results.
2. Apply the pending migrations from `0004_multichannel_replies.sql` through
   `0007_automation_trigger_modes.sql` in Supabase SQL Editor if any are pending.
3. Commit and push only after explicit approval.
4. Wait for the Vercel production deployment to become ready.
5. In Meta's Instagram use-case settings, enable `instagram_business_manage_messages` at an access
   level that covers the test account.
6. Reconnect Instagram and grant profile, comment, and message access so the stored token contains
   all three required permissions.
7. Open the app, reload the automation editor, and save the desired mode and message text.
8. Run the manual acceptance cases in the Milestone 9 plan.

Migration `0004` preserves existing automations as **Public reply only** and preserves existing
execution records as public deliveries. It also installs a compatibility trigger that snapshots the
automation's public reply when the previous production version inserts an execution without the new
`message_text` column. Migration `0007` preserves every existing trigger as **Exact text** and adds
the **Contains whole word or hashtag** and **Every top-level comment** modes. Apply migrations
before deploying the application.

## Review log and known external risks

Meta production acceptance requires a real comment from a different Instagram account. The project
owner completed that acceptance and reviewed Activity statuses and sanitized Vercel logs.

Production verification on September 28–30, 2026 confirmed that migrations `0004`, `0005`, `0006`,
and `0007` were applied, messaging permission was granted through a fresh Instagram connection, and
matching comments created successful public and private deliveries. The public reply's nested
webhook was deliberately ignored. A signed messaging webhook was acknowledged with `200` as an
unsupported event, without a new `400 invalid_comment_event` response. The project owner confirmed
the remaining Milestone 9 and Milestone 10 manual acceptance cases passed.

| Risk                                                                   | Expected detection                                                                  | Action                                                                                  |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Token lacks `instagram_business_manage_messages`                       | Private channel becomes failed or retry pending with a safe provider classification | Enable the permission in Meta, deploy the required OAuth scope, and reconnect Instagram |
| Comment is too old or already used for a private reply                 | Meta rejects only the private channel                                               | Use a new top-level comment; do not retry the same private reply manually               |
| Test comment is a reply or belongs to the connected owner              | No execution is created                                                             | Test with a new top-level comment from another account                                  |
| Provider accepts a request but the connection ends before confirmation | Channel becomes `Review needed`                                                     | Inspect Instagram before any manual resend to avoid a duplicate                         |
| Database migration was not applied before deployment                   | API requests fail with sanitized storage errors                                     | Apply the pending migration before deploying the matching runtime                       |

Do not paste access tokens, private message content, comment content, or raw Meta response bodies
into issue reports. Record only the time, selected delivery mode, Activity status, safe application
error code, and sanitized Vercel log context.
