create schema if not exists app_private;

revoke all on schema app_private from public;

alter default privileges in schema app_private revoke all on tables from public;
alter default privileges in schema app_private revoke all on sequences from public;
alter default privileges in schema app_private revoke execute on functions from public;

create function app_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

revoke all on function app_private.set_updated_at() from public;

create table app_private.instagram_accounts (
  id uuid primary key default gen_random_uuid(),
  instagram_user_id text not null,
  username text not null,
  access_token_ciphertext text not null,
  token_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instagram_accounts_instagram_user_id_unique unique (instagram_user_id),
  constraint instagram_accounts_instagram_user_id_not_blank
    check (btrim(instagram_user_id) <> ''),
  constraint instagram_accounts_username_not_blank check (btrim(username) <> ''),
  constraint instagram_accounts_access_token_ciphertext_not_blank
    check (btrim(access_token_ciphertext) <> '')
);

create trigger instagram_accounts_set_updated_at
before update on app_private.instagram_accounts
for each row execute function app_private.set_updated_at();

create table app_private.sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  token_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint sessions_account_foreign_key
    foreign key (account_id)
    references app_private.instagram_accounts (id)
    on delete cascade,
  constraint sessions_token_hash_unique unique (token_hash),
  constraint sessions_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$')
);

create index sessions_account_id_index on app_private.sessions (account_id);
create index sessions_expires_at_index on app_private.sessions (expires_at);

create table app_private.automations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  media_id text not null,
  trigger_text text not null default '#Hello',
  reply_text text not null,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automations_account_foreign_key
    foreign key (account_id)
    references app_private.instagram_accounts (id)
    on delete restrict,
  constraint automations_account_id_unique unique (account_id),
  constraint automations_media_id_not_blank check (btrim(media_id) <> ''),
  constraint automations_trigger_text_fixed check (trigger_text = '#Hello'),
  constraint automations_reply_text_not_blank check (btrim(reply_text) <> '')
);

create trigger automations_set_updated_at
before update on app_private.automations
for each row execute function app_private.set_updated_at();

create table app_private.executions (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null,
  instagram_comment_id text not null,
  commenter_username text,
  comment_text text not null,
  status text not null,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint executions_automation_foreign_key
    foreign key (automation_id)
    references app_private.automations (id)
    on delete restrict,
  constraint executions_instagram_comment_id_unique unique (instagram_comment_id),
  constraint executions_instagram_comment_id_not_blank
    check (btrim(instagram_comment_id) <> ''),
  constraint executions_commenter_username_not_blank
    check (commenter_username is null or btrim(commenter_username) <> ''),
  constraint executions_comment_text_not_blank check (btrim(comment_text) <> ''),
  constraint executions_status_allowed check (status in ('processing', 'succeeded', 'failed')),
  constraint executions_error_code_not_blank
    check (error_code is null or btrim(error_code) <> ''),
  constraint executions_error_message_not_blank
    check (error_message is null or btrim(error_message) <> '')
);

create index executions_automation_created_at_index
on app_private.executions (automation_id, created_at desc);

create trigger executions_set_updated_at
before update on app_private.executions
for each row execute function app_private.set_updated_at();

alter table app_private.instagram_accounts enable row level security;
alter table app_private.sessions enable row level security;
alter table app_private.automations enable row level security;
alter table app_private.executions enable row level security;

revoke all on all tables in schema app_private from public;
revoke all on all sequences in schema app_private from public;
revoke execute on all functions in schema app_private from public;

do $$
declare
  application_role text;
begin
  foreach application_role in array array['anon', 'authenticated', 'service_role']
  loop
    if exists (select 1 from pg_roles where rolname = application_role) then
      execute format('revoke all on schema app_private from %I', application_role);
      execute format('revoke all on all tables in schema app_private from %I', application_role);
      execute format('revoke all on all sequences in schema app_private from %I', application_role);
      execute format('revoke execute on all functions in schema app_private from %I', application_role);
      execute format(
        'alter default privileges in schema app_private revoke all on tables from %I',
        application_role
      );
      execute format(
        'alter default privileges in schema app_private revoke all on sequences from %I',
        application_role
      );
      execute format(
        'alter default privileges in schema app_private revoke execute on functions from %I',
        application_role
      );
    end if;
  end loop;
end;
$$;
