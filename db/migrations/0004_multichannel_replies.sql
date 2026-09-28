alter table app_private.automations
  drop constraint automations_trigger_text_fixed,
  drop constraint automations_reply_text_not_blank,
  add column delivery_mode text not null default 'public',
  add column private_reply_text text,
  add constraint automations_trigger_text_hashtag
    check (
      trigger_text = btrim(trigger_text)
      and char_length(trigger_text) between 2 and 100
      and trigger_text ~ '^#[^[:space:]]+$'
    ),
  add constraint automations_delivery_mode_allowed
    check (delivery_mode in ('public', 'private', 'both')),
  add constraint automations_public_reply_text_required
    check (delivery_mode = 'private' or btrim(reply_text) <> ''),
  add constraint automations_private_reply_text_required
    check (
      (delivery_mode = 'public' and private_reply_text is null)
      or (
        delivery_mode in ('private', 'both')
        and private_reply_text is not null
        and btrim(private_reply_text) <> ''
      )
    );

alter table app_private.executions
  drop constraint executions_instagram_comment_id_unique,
  add column delivery_channel text not null default 'public',
  add column message_text text,
  add column commenter_instagram_id text,
  add constraint executions_delivery_channel_allowed
    check (delivery_channel in ('public', 'private')),
  add constraint executions_message_text_not_blank
    check (message_text is null or btrim(message_text) <> ''),
  add constraint executions_commenter_instagram_id_not_blank
    check (commenter_instagram_id is null or btrim(commenter_instagram_id) <> '');

update app_private.executions as execution
set message_text = automation.reply_text
from app_private.automations as automation
where automation.id = execution.automation_id;

alter table app_private.executions
  alter column message_text set not null,
  add constraint executions_instagram_comment_channel_unique
    unique (instagram_comment_id, delivery_channel);

create function app_private.fill_legacy_execution_message_text()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.message_text is null then
    select automation.reply_text
    into new.message_text
    from app_private.automations as automation
    where automation.id = new.automation_id;
  end if;

  return new;
end;
$$;

revoke all on function app_private.fill_legacy_execution_message_text() from public;

create trigger executions_fill_legacy_message_text
before insert on app_private.executions
for each row execute function app_private.fill_legacy_execution_message_text();
