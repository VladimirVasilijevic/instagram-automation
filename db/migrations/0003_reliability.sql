alter table app_private.instagram_accounts
  add column connection_status text not null default 'active',
  add column token_refresh_last_succeeded_at timestamptz,
  add column token_refresh_next_attempt_at timestamptz,
  add column token_refresh_failure_code text,
  add column token_refresh_lease_id uuid,
  add column token_refresh_lease_until timestamptz,
  add constraint instagram_accounts_connection_status_allowed
    check (connection_status in ('active', 'reconnect_required')),
  add constraint instagram_accounts_token_refresh_failure_code_not_blank
    check (token_refresh_failure_code is null or btrim(token_refresh_failure_code) <> ''),
  add constraint instagram_accounts_token_refresh_lease_complete
    check (
      (token_refresh_lease_id is null and token_refresh_lease_until is null)
      or (token_refresh_lease_id is not null and token_refresh_lease_until is not null)
    );

create index instagram_accounts_token_refresh_due_index
on app_private.instagram_accounts (token_expires_at, token_refresh_next_attempt_at)
where connection_status = 'active';

alter table app_private.executions
  drop constraint executions_status_allowed,
  add column attempt_count integer not null default 1,
  add column next_attempt_at timestamptz,
  add column lease_id uuid,
  add column lease_expires_at timestamptz,
  add column dispatch_started_at timestamptz,
  add column provider_reply_id text,
  add column failure_kind text,
  add constraint executions_status_allowed
    check (status in ('processing', 'retry_pending', 'succeeded', 'failed', 'uncertain')),
  add constraint executions_attempt_count_positive check (attempt_count between 1 and 3),
  add constraint executions_provider_reply_id_not_blank
    check (provider_reply_id is null or btrim(provider_reply_id) <> ''),
  add constraint executions_failure_kind_allowed
    check (
      failure_kind is null
      or failure_kind in ('authentication', 'permanent', 'retryable', 'uncertain')
    ),
  add constraint executions_lease_complete
    check (
      (lease_id is null and lease_expires_at is null)
      or (lease_id is not null and lease_expires_at is not null)
    );

update app_private.executions
set
  status = case when status = 'processing' then 'uncertain' else status end,
  failure_kind = case
    when status = 'failed' then 'permanent'
    when status = 'processing' then 'uncertain'
    else null
  end,
  error_code = case
    when status = 'processing' then 'DELIVERY_OUTCOME_UNKNOWN'
    else error_code
  end,
  error_message = case
    when status = 'processing' then 'Delivery requires manual review to prevent a duplicate reply.'
    else error_message
  end;

create index executions_recovery_due_index
on app_private.executions (next_attempt_at, lease_expires_at)
where status in ('processing', 'retry_pending');
