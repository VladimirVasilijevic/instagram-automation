-- Legacy automations and execution snapshots remain comment-triggered.
alter table app_private.automations
  add column trigger_kind text not null default 'comment'
    check (trigger_kind in ('comment', 'story_reply')),
  add constraint automations_story_private_only
    check (trigger_kind <> 'story_reply' or delivery_mode = 'private');

alter table app_private.executions
  add column reply_window_expires_at timestamptz,
  add column trigger_kind text not null default 'comment'
    check (trigger_kind in ('comment', 'story_reply')),
  add constraint executions_story_private_only
    check (trigger_kind <> 'story_reply' or delivery_channel = 'private');
