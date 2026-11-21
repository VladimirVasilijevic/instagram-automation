create table app_private.users (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger users_set_updated_at
before update on app_private.users
for each row execute function app_private.set_updated_at();

create table app_private.login_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_private.users (id) on delete restrict,
  provider text not null check (provider in ('instagram', 'facebook')),
  external_user_id text not null check (btrim(external_user_id) <> ''),
  display_name text not null check (btrim(display_name) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint login_identities_provider_external_unique unique (provider, external_user_id)
);

create index login_identities_user_index on app_private.login_identities (user_id);

create trigger login_identities_set_updated_at
before update on app_private.login_identities
for each row execute function app_private.set_updated_at();

create table app_private.social_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_private.users (id) on delete restrict,
  provider text not null check (provider in ('instagram', 'facebook')),
  external_account_id text not null check (btrim(external_account_id) <> ''),
  display_name text not null check (btrim(display_name) <> ''),
  connection_status text not null default 'active'
    check (connection_status in ('active', 'reconnect_required')),
  connection_failure_code text check (
    connection_failure_code is null or btrim(connection_failure_code) <> ''
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_connections_provider_external_unique unique (provider, external_account_id)
);

create index social_connections_user_index on app_private.social_connections (user_id);

create trigger social_connections_set_updated_at
before update on app_private.social_connections
for each row execute function app_private.set_updated_at();

create table app_private.facebook_pages (
  connection_id uuid primary key references app_private.social_connections (id) on delete restrict,
  access_token_ciphertext text not null check (btrim(access_token_ciphertext) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger facebook_pages_set_updated_at
before update on app_private.facebook_pages
for each row execute function app_private.set_updated_at();

create table app_private.pending_page_selections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_private.users (id) on delete cascade,
  pages jsonb not null check (jsonb_typeof(pages) = 'array'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index pending_page_selections_expires_index
on app_private.pending_page_selections (expires_at);

insert into app_private.users (id, created_at, updated_at)
select id, created_at, updated_at from app_private.instagram_accounts;

insert into app_private.login_identities (
  user_id, provider, external_user_id, display_name, created_at, updated_at
)
select id, 'instagram', instagram_user_id, username, created_at, updated_at
from app_private.instagram_accounts;

insert into app_private.social_connections (
  id, user_id, provider, external_account_id, display_name, connection_status,
  created_at, updated_at
)
select id, id, 'instagram', instagram_user_id, username, connection_status,
  created_at, updated_at
from app_private.instagram_accounts;

alter table app_private.sessions
  add column user_id uuid references app_private.users (id) on delete cascade;

update app_private.sessions set user_id = account_id;

alter table app_private.sessions
  alter column user_id set not null,
  alter column account_id drop not null;

create index sessions_user_id_index on app_private.sessions (user_id);

alter table app_private.oauth_states
  add column provider text not null default 'instagram'
    check (provider in ('instagram', 'facebook')),
  add column intent text not null default 'sign_in'
    check (intent in ('sign_in', 'connect_page')),
  add column intended_user_id uuid references app_private.users (id) on delete cascade;

alter table app_private.users enable row level security;
alter table app_private.login_identities enable row level security;
alter table app_private.social_connections enable row level security;
alter table app_private.facebook_pages enable row level security;
alter table app_private.pending_page_selections enable row level security;

revoke all on table app_private.users from public;
revoke all on table app_private.login_identities from public;
revoke all on table app_private.social_connections from public;
revoke all on table app_private.facebook_pages from public;
revoke all on table app_private.pending_page_selections from public;

do $$
declare
  application_role text;
begin
  foreach application_role in array array['anon', 'authenticated', 'service_role']
  loop
    if exists (select 1 from pg_roles where rolname = application_role) then
      execute format('revoke all on app_private.users from %I', application_role);
      execute format('revoke all on app_private.login_identities from %I', application_role);
      execute format('revoke all on app_private.social_connections from %I', application_role);
      execute format('revoke all on app_private.facebook_pages from %I', application_role);
      execute format('revoke all on app_private.pending_page_selections from %I', application_role);
    end if;
  end loop;
end;
$$;
