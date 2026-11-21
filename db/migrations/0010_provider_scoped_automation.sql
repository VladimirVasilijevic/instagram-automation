-- One automation belongs to a social connection; existing Instagram IDs are preserved.
alter table app_private.instagram_accounts
  add constraint instagram_accounts_connection_foreign_key
  foreign key (id) references app_private.social_connections (id) on delete restrict;

alter table app_private.automations
  add column connection_id uuid references app_private.social_connections (id) on delete restrict;

update app_private.automations set connection_id = account_id;

alter table app_private.automations
  alter column connection_id set not null,
  alter column account_id drop not null,
  add constraint automations_connection_id_unique unique (connection_id);

-- Provider comment IDs are only unique within their automation/connection.
alter table app_private.executions
  drop constraint executions_instagram_comment_channel_unique,
  add constraint executions_connection_comment_channel_unique
    unique (automation_id, instagram_comment_id, delivery_channel);

-- Incoming Messenger answers and follow-ups may belong to a Facebook Page.
alter table app_private.inbound_dm_answers
  add column connection_id uuid references app_private.social_connections (id) on delete restrict;

update app_private.inbound_dm_answers set connection_id = account_id;

alter table app_private.inbound_dm_answers
  alter column connection_id set not null,
  alter column account_id drop not null,
  drop constraint inbound_dm_answers_message_unique,
  add constraint inbound_dm_answers_connection_message_unique
    unique (connection_id, provider_message_id);

create index inbound_dm_answers_connection_received_index
on app_private.inbound_dm_answers (connection_id, received_at desc);

alter table app_private.dm_followups
  add column connection_id uuid references app_private.social_connections (id) on delete restrict;

update app_private.dm_followups set connection_id = account_id;

alter table app_private.dm_followups
  alter column connection_id set not null,
  alter column account_id drop not null;

create index dm_followups_connection_index
on app_private.dm_followups (connection_id, created_at desc);
