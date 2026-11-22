# Multiple automations, Instagram Reels and Stories

An automation belongs to one social connection and one provider media ID. A connection can have many
enabled rules. Saving or disabling one item must not change another item's rule or history.

## Browsing and editing

Posts and Instagram Reels share the same media catalog, picker, rule editor, comment matching,
delivery, execution deduplication and follow-up processing. Each item restores its own saved rule or
a new default form. Drafts remain local to the selected item until saved; switching connections
clears them. A saved rule outside the currently loaded catalog remains available for review and
disabling. Enabling a rule requires server-side provider ownership validation.

The media catalog returns the existing normalized media fields plus
`contentKind: post | reel | story`. Pagination cursors are bound to the selected connection and
content section. Sparse Instagram sections scan a bounded number of provider pages and return a
continuation instead of silently claiming that no older matching items exist. Provider responses and
tokens remain server side.

## HTTP contracts

- `GET /api/automation` returns `{ automations: [...] }` for the selected connection.
- `GET /api/automation?mediaId=...` returns `{ automation: ... | null }` for one owned rule.
- `PUT /api/automation` retains the existing payload with `mediaId`; it upserts only that pair.
- `GET /api/media?kind=post|reel|story&limit=12&cursor=...` returns `{ media, nextCursor }`.

The webhook processors already find an enabled rule by connection and media ID. Conversation answers
continue to use the originating execution and stored quick-reply payload. Ambiguous free-text
answers must not choose a different pending prompt arbitrarily. Connections use full messaging
consent: every enabled rule, including a public-only rule, subscribes to comment/feed and message
events. Saving or disabling another rule never downgrades those subscriptions, so previously sent
prompts remain answerable.

## Database and release coordination

Migration `0011_automations_per_media.sql` removes both the legacy Instagram account uniqueness and
the connection uniqueness constraints, then adds `UNIQUE(connection_id, media_id)`. Existing IDs,
rules, executions, protected tokens and follow-up references are retained. The new repository uses
the composite conflict target. Older application code uses `ON CONFLICT(connection_id)` and is
incompatible after the migration; do not apply this migration independently to Production.

Prepare the new release and validate it against the isolated test database first. For a Production
release, obtain explicit approval for the coordinated migration and deployment. Use a controlled
maintenance interval: stop configuration writes, drain old work, apply the migration, deploy the new
release, verify existing rules and a new independent rule, then restore configuration writes. If
rollback is needed, first inspect newly created multi-rule connections; restoring the old constraint
may require choosing which rule to retain. Never delete rules automatically to roll back.

## Provider evidence and remaining acceptance

Read-only discovery against the connected Instagram Login API at v24.0 confirmed
`media_product_type=REELS`, owner identity and preview availability. No raw media content, tokens or
signed asset URLs belong in logs. Tests use synthetic responses.

Facebook Page post automation remains supported. Its Reel listing endpoint returned HTTP 200 but no
items on the connected Page. Meta's endpoint and publishing-guide references disagree about reading
Reels, and a real Reel comment webhook has not established how video IDs relate to `post_id`.
Facebook Reel automation is therefore unavailable in this release. Do not fabricate ID aliases or
advertise successful live acceptance from adapter unit tests.

## Instagram Story replies

Instagram Stories use the same catalog and editor, with a separate Stories section. Only active,
owned Stories can be enabled. Expired saved rules remain available for disabling. Matching applies
to the text of an incoming Story reply and delivery is private only. Facebook Stories remain
unavailable; neither their discovery nor their reply context has been verified.

The webhook boundary preserves `message.reply_to.story.id` and routes those messages separately
before ordinary DM answer handling. A Story reply cannot consume an outstanding quick-reply prompt.
The processor selects the exact Story rule, deduplicates using the inbound message ID, and uses the
shared execution lease, retry and outcome pipeline. Initial messages address the sender's
Instagram-scoped ID, rather than using the comment-addressed private reply endpoint. Optional quick
replies reuse stored choices and the existing follow-up workflow.

Migration `0012_story_reply_triggers.sql` defaults existing rules and executions to `comment`, adds
a private-only constraint for `story_reply`, and stores the inbound reply-window deadline in
execution snapshots. Dispatch checks that deadline before decrypting a token or sending, including
on scheduled retries. The deadline is 24 hours from the incoming reply, independently of when the
Story itself expires. A future live acceptance check must confirm discovery, a real signed Story
reply, its private response and a quick-reply follow-up; unit tests do not establish live
acceptance.

## Isolated verification

Run the complete repository verification skill, then opt-in PostgreSQL integration tests only
against the dedicated test database. Run the repeatable multi-automation simulation:

```bash
pnpm --filter @instagram-automation/api load-test:simulate
```

The simulation rejects known application database endpoints, creates uniquely scoped synthetic
Instagram and Facebook owners with two comment rules each plus an Instagram Story rule. It processes
concurrent duplicates of 80 comments and 20 Story replies (200 inputs), uses fake provider sends and
checks exactly 180 successful executions and dispatches. It does not call Meta. Fixtures are removed
after the run. This is a bounded concurrency/correctness simulation, not a capacity benchmark or
proof of live Facebook Reel support.
