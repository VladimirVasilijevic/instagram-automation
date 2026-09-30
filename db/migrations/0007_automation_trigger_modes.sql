alter table app_private.automations
  drop constraint automations_trigger_text_hashtag,
  alter column trigger_text drop not null,
  alter column trigger_text drop default,
  add column trigger_mode text not null default 'exact',
  add constraint automations_trigger_mode_allowed
    check (trigger_mode in ('exact', 'contains', 'all')),
  add constraint automations_trigger_configuration_valid
    check (
      (trigger_mode = 'all' and trigger_text is null)
      or (
        trigger_mode = 'exact'
        and trigger_text is not null
        and trigger_text = btrim(trigger_text)
        and char_length(trigger_text) between 1 and 100
      )
      or (
        trigger_mode = 'contains'
        and trigger_text is not null
        and trigger_text = btrim(trigger_text)
        and char_length(trigger_text) between 1 and 100
        and trigger_text ~ '^#?[[:alnum:]_]+$'
      )
    );
