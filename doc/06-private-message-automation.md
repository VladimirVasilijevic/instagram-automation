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

## Quick replies and one follow-up

For **Private DM only** or **Public reply and private DM**, the owner chooses a private DM format:
**Private message only** sends text without buttons, while **Prompt with quick replies** sends
prompt text with 1 to 13 choices in the same DM. Each choice has a title of at most 20 characters
and one configured follow-up message. Saving the text-only format clears previously saved choices.
The editor restores the quick-reply format when a saved automation has choices. The public comment
reply never contains quick replies. The choice configuration is saved with each private execution so
a controlled retry uses the original question and choices if the owner edits the automation later.
Check button rendering in the Instagram mobile app; the desktop browser may show only text.

When the recipient taps a choice, Instagram sends an inbound message webhook. ReplyKit matches the
choice to the original private execution, records the answer once, and sends the selected follow-up
as a normal recipient-addressed DM. A typed answer sent within 24 hours after the question starts
sending is saved for owner review and does not trigger an automatic follow-up. If multiple pending
questions make a typed answer ambiguous, it remains unmatched rather than being assigned to the
wrong question. Repeated webhook deliveries cannot send the same follow-up again. Follow-up attempts
stop when the standard messaging window closes; an uncertain send requires manual review to avoid a
duplicate. Blank message text is ignored unless it accompanies a quick-reply choice payload.

Quick replies do not authorize a new campaign message days later. A person's inbound answer opens
the ordinary messaging window, which generally lasts 24 hours for this entry point. The follow-up is
sent promptly after that answer, subject to Meta accepting the request.

## Deployment order

1. Review the code and verification results.
2. Apply the pending migrations from `0004_multichannel_replies.sql` through
   `0008_quick_reply_conversations.sql` in Supabase SQL Editor if any are pending. Migration `0008`
   adds saved choices, private-delivery snapshots, inbound answers, and durable follow-up jobs.
3. In Meta's Instagram use-case settings, enable `instagram_business_manage_messages` at an access
   level that covers the test account. Select the `messages` webhook field in the App Dashboard,
   alongside `comments`, before enabling quick replies. Account subscriptions request both fields
   when quick replies are configured; text-only automations continue to request `comments`.
4. Commit and push only after explicit approval.
5. Wait for the Vercel production deployment to become ready.
6. Reconnect Instagram if the stored token lacks profile, comment, or message access.
7. Open the app, reload the automation editor, and save the desired delivery mode and private DM
   format. The quick-reply format requires prompt text and at least one completed choice.
8. From a separate consenting test account, leave a fresh top-level comment, inspect the received DM
   on Instagram, tap a quick reply, and confirm exactly one matching follow-up and answer in
   ReplyKit. Use another fresh test comment to type a response; confirm it is saved without an
   automatic follow-up.

Migration `0004` preserves existing automations as **Public reply only** and preserves existing
execution records as public deliveries. It also installs a compatibility trigger that snapshots the
automation's public reply when the previous production version inserts an execution without the new
`message_text` column. Migration `0007` preserves every existing trigger as **Exact text** and adds
the **Contains whole word or hashtag** and **Every top-level comment** modes. Apply migrations
before deploying the application.

The quick-reply payload on the **first comment-addressed private reply** has not been verified
against live Meta delivery. The project owner chose to proceed with local implementation before a
live compatibility test. Local tests verify the request shape and application behavior, but they
cannot prove that Meta accepts or displays the buttons. If Meta rejects that combination, do not
silently resend or deploy a different conversation flow; revise the implementation plan first.

## Review log and known external risks

Meta production acceptance requires a real comment from a different Instagram account. The project
owner completed that acceptance and reviewed Activity statuses and sanitized Vercel logs.

Production verification on September 28–30, 2026 confirmed that migrations `0004`, `0005`, `0006`,
and `0007` were applied, messaging permission was granted through a fresh Instagram connection, and
matching comments created successful public and private deliveries. The public reply's nested
webhook was deliberately ignored. A signed messaging webhook was acknowledged with `200` as an
unsupported event, without a new `400 invalid_comment_event` response. The project owner confirmed
the remaining Milestone 9 and Milestone 10 manual acceptance cases passed. This acceptance predates
the quick-reply feature and does not verify inbound answers or follow-up delivery.

| Risk                                                                   | Expected detection                                                                  | Action                                                                                  |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Token lacks `instagram_business_manage_messages`                       | Private channel becomes failed or retry pending with a safe provider classification | Enable the permission in Meta, deploy the required OAuth scope, and reconnect Instagram |
| Comment is too old or already used for a private reply                 | Meta rejects only the private channel                                               | Use a new top-level comment; do not retry the same private reply manually               |
| Test comment is a reply or belongs to the connected owner              | No execution is created                                                             | Test with a new top-level comment from another account                                  |
| Provider accepts a request but the connection ends before confirmation | Channel becomes `Review needed`                                                     | Inspect Instagram before any manual resend to avoid a duplicate                         |
| Database migration was not applied before deployment                   | API requests fail with sanitized storage errors                                     | Apply the pending migration before deploying the matching runtime                       |
| `messages` webhook field is not enabled in Meta                        | A quick-reply automation may fail to save                                           | Select the field in the App Dashboard before enabling quick replies                     |
| Meta rejects quick replies on the first comment-addressed private DM   | Private execution fails with a safe provider classification                         | Stop and revise the flow before sending another message to that comment                 |
| A follow-up is uncertain or the messaging window has closed            | Follow-up is marked for review or failed                                            | Inspect Instagram before any manual resend; never assume another send is allowed        |

Do not paste access tokens, private message content, comment content, or raw Meta response bodies
into issue reports. Record only the time, selected delivery mode, Activity status, safe application
error code, and sanitized Vercel log context.
