create table app_private.oauth_states (
  state_hash text primary key check (state_hash ~ '^[0-9a-f]{64}$'),
  browser_binding_hash text not null check (browser_binding_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index oauth_states_expires_at_index on app_private.oauth_states (expires_at);

alter table app_private.oauth_states enable row level security;
revoke all on app_private.oauth_states from public;

do $$
declare
  application_role text;
begin
  foreach application_role in array array['anon', 'authenticated', 'service_role']
  loop
    if exists (select 1 from pg_roles where rolname = application_role) then
      execute format('revoke all on app_private.oauth_states from %I', application_role);
    end if;
  end loop;
end;
$$;
