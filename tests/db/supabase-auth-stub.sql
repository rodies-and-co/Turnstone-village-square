-- TEST ONLY. A minimal stand-in for the parts of Supabase that the database
-- security rules rely on: the anon/authenticated roles, auth.users,
-- auth.mfa_factors, auth.uid(), auth.jwt() and the supabase_auth_admin role. In real Supabase these already
-- exist. Signed-in users are simulated by setting request.jwt.claims, exactly
-- as Supabase does for each API request.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

create schema auth;

create table auth.users (
  id uuid primary key,
  email text unique,
  raw_app_meta_data jsonb not null default '{}'
);

create table auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null
);

create function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;

create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

grant usage on schema auth to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;

-- Supabase grants table access to these roles by default and relies on RLS.
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

-- The role Supabase Auth uses to call the sign-in token hook.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin;
  end if;
end
$$;
