alter table app_private.automations
  add column quick_reply_options jsonb not null default '[]'::jsonb,
  add constraint automations_quick_reply_options_array
    check (jsonb_typeof(quick_reply_options) = 'array'
      and jsonb_array_length(quick_reply_options) <= 13),
  add constraint automations_quick_reply_private_only
    check (delivery_mode <> 'public' or quick_reply_options = '[]'::jsonb);

alter table app_private.executions
  add column quick_reply_options jsonb not null default '[]'::jsonb,
  add column recipient_igsid text,
  add constraint executions_quick_reply_options_array
    check (jsonb_typeof(quick_reply_options) = 'array'
      and jsonb_array_length(quick_reply_options) <= 13),
  add constraint executions_quick_reply_private_only
    check (delivery_channel = 'private' or quick_reply_options = '[]'::jsonb),
  add constraint executions_recipient_igsid_private_only
    check (recipient_igsid is null or
      (delivery_channel = 'private' and btrim(recipient_igsid) <> ''));

create index executions_private_recipient_index
on app_private.executions (recipient_igsid, created_at desc)
where delivery_channel = 'private' and recipient_igsid is not null;

create table app_private.inbound_dm_answers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references app_private.instagram_accounts (id) on delete restrict,
  execution_id uuid references app_private.executions (id) on delete restrict,
  provider_message_id text not null,
  sender_igsid text not null,
  option_id uuid,
  text text,
  sent_at timestamptz not null,
  received_at timestamptz not null default now(),
  constraint inbound_dm_answers_message_unique unique (account_id, provider_message_id),
  constraint inbound_dm_answers_execution_unique unique (execution_id),
  constraint inbound_dm_answers_message_not_blank check (btrim(provider_message_id) <> ''),
  constraint inbound_dm_answers_sender_not_blank check (btrim(sender_igsid) <> ''),
  constraint inbound_dm_answers_choice_has_execution
    check (option_id is null or execution_id is not null),
  constraint inbound_dm_answers_text_not_blank check (text is null or btrim(text) <> '')
);

create index inbound_dm_answers_account_received_index
on app_private.inbound_dm_answers (account_id, received_at desc);

create table app_private.dm_followups (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references app_private.instagram_accounts (id) on delete restrict,
  answer_id uuid not null references app_private.inbound_dm_answers (id) on delete restrict,
  recipient_igsid text not null,
  message_text text not null,
  expires_at timestamptz not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  lease_id uuid,
  lease_expires_at timestamptz,
  dispatch_started_at timestamptz,
  provider_reply_id text,
  failure_kind text,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dm_followups_answer_unique unique (answer_id),
  constraint dm_followups_recipient_not_blank check (btrim(recipient_igsid) <> ''),
  constraint dm_followups_message_not_blank check (btrim(message_text) <> ''),
  constraint dm_followups_status_allowed
    check (status in ('pending', 'processing', 'retry_pending', 'succeeded', 'failed', 'uncertain')),
  constraint dm_followups_attempt_count_allowed check (attempt_count between 0 and 3),
  constraint dm_followups_lease_complete
    check ((lease_id is null and lease_expires_at is null)
      or (lease_id is not null and lease_expires_at is not null)),
  constraint dm_followups_provider_reply_id_not_blank
    check (provider_reply_id is null or btrim(provider_reply_id) <> ''),
  constraint dm_followups_failure_kind_allowed
    check (failure_kind is null or
      failure_kind in ('authentication', 'permanent', 'retryable', 'uncertain')),
  constraint dm_followups_error_code_not_blank
    check (error_code is null or btrim(error_code) <> ''),
  constraint dm_followups_error_message_not_blank
    check (error_message is null or btrim(error_message) <> '')
);

create index dm_followups_due_index
on app_private.dm_followups (next_attempt_at, lease_expires_at, expires_at)
where status in ('pending', 'processing', 'retry_pending');

create trigger dm_followups_set_updated_at
before update on app_private.dm_followups
for each row execute function app_private.set_updated_at();

alter table app_private.inbound_dm_answers enable row level security;
alter table app_private.dm_followups enable row level security;
revoke all on table app_private.inbound_dm_answers from public;
revoke all on table app_private.dm_followups from public;

do $$
declare
  application_role text;
begin
  foreach application_role in array array['anon', 'authenticated', 'service_role']
  loop
    if exists (select 1 from pg_roles where rolname = application_role) then
      execute format('revoke all on app_private.inbound_dm_answers from %I', application_role);
      execute format('revoke all on app_private.dm_followups from %I', application_role);
    end if;
  end loop;
end;
$$;
