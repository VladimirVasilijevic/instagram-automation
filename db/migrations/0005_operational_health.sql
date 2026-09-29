create table app_private.maintenance_health (
  singleton boolean primary key default true,
  last_succeeded_at timestamptz,
  last_failed_at timestamptz,
  last_failure_code text,
  expired_token_count integer not null default 0,
  reconnect_required_count integer not null default 0,
  reply_failed_count integer not null default 0,
  reply_retry_pending_count integer not null default 0,
  reply_succeeded_count integer not null default 0,
  reply_uncertain_count integer not null default 0,
  stale_execution_count integer not null default 0,
  token_refresh_failed_count integer not null default 0,
  token_refreshed_count integer not null default 0,
  constraint maintenance_health_singleton check (singleton),
  constraint maintenance_health_failure_code_not_blank
    check (last_failure_code is null or btrim(last_failure_code) <> ''),
  constraint maintenance_health_counts_nonnegative check (
    expired_token_count >= 0
    and reconnect_required_count >= 0
    and reply_failed_count >= 0
    and reply_retry_pending_count >= 0
    and reply_succeeded_count >= 0
    and reply_uncertain_count >= 0
    and stale_execution_count >= 0
    and token_refresh_failed_count >= 0
    and token_refreshed_count >= 0
  )
);

alter table app_private.maintenance_health enable row level security;
revoke all on table app_private.maintenance_health from public;

do $$
declare
  application_role text;
begin
  foreach application_role in array array['anon', 'authenticated', 'service_role']
  loop
    if exists (select 1 from pg_roles where rolname = application_role) then
      execute format(
        'revoke all on table app_private.maintenance_health from %I',
        application_role
      );
    end if;
  end loop;
end;
$$;
