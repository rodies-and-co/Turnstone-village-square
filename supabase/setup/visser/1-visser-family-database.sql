-- VISSER family project: everything in one go.
-- Run ONCE in the Village-Square-Visser project's SQL Editor (paste the whole
-- file, then Run). It:
--   1. creates the family database (the foundation only: afterwards, also run
--      each later file in supabase/family/migrations, starting with the Tree),
--   2. ties it to the Visser family in the hub and to the hub's sign-in,
--   3. adds fictional practice people and branches.
-- The Visser family is fictional. Never use this file for a real family.

-- Turnstone Village Square: one family's own database (foundation)
--
-- Each family has its own Supabase project. This migration is run in every
-- family project. It holds only that family's records.
--
-- Nobody signs in to a family project directly. People sign in to the hub,
-- and their sign-in token carries their roles (see the hub's
-- custom_access_token_hook):
--   vs.system_role - 'super_user' | 'system_admin' | null
--   vs.families    - { "<family id>": "manager" | "administrator" | "viewer" }
--   vs.mfa         - true when the user has two-factor set up
-- This database knows its own family id and the hub's address
-- (family_settings). It only accepts tokens issued by that hub, and only
-- honours the role given for its own family id. A token for another family,
-- or from anywhere else, gets nothing here.
--
-- Roles in this database:
--   Super User     - everything (with two-factor)
--   Manager        - read, add, change and approve; manages access grants
--   Administrator  - read, add and change; no deleting, no access management
--   Viewer         - read only, limited to their access grants
--   System Admin   - no family records (system work happens in the hub)
-- Managers, Administrators and Super Users must have completed two-factor.
-- Viewers may skip two-factor, but once set up it must be used.

create schema if not exists private;

create type public.member_type as enum ('family', 'family_not_succession', 'non_family');

-- The three circle model (family, ownership, business): the seven positions.
create type public.three_circle_role as enum (
  'family_member',
  'outside_owner',
  'employee',
  'employee_owner',
  'family_employee',
  'family_owner',
  'family_leader'
);

create type public.grant_scope as enum ('whole_family', 'branch', 'own_record');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Exactly one row: which family this database belongs to. Set once when the
-- family's project is created; family_id must match the hub's families.id.
create table public.family_settings (
  singleton boolean primary key default true check (singleton),
  family_id uuid not null,
  family_name text not null check (length(trim(family_name)) > 0),
  -- The hub's sign-in address, e.g. https://<hub>.supabase.co/auth/v1.
  -- Tokens from any other issuer are ignored.
  hub_issuer text not null check (hub_issuer ~ '^https://[a-z0-9.-]+/auth/v1$'),
  created_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  description text,
  created_at timestamptz not null default now()
);

-- The Tree: one row per person.
create table public.people (
  id uuid primary key default gen_random_uuid(),
  member_type public.member_type not null,
  full_names text not null check (length(trim(full_names)) > 0),
  surname text not null check (length(trim(surname)) > 0),
  maiden_name text,
  known_as text,
  date_of_birth date,
  birth_year integer check (birth_year between 1850 and 2200),
  deceased boolean not null default false,
  three_circle_role public.three_circle_role,
  branch_id uuid references public.branches (id) on delete set null,
  -- The person's hub login, when they use the family portal.
  user_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (date_of_birth is null or birth_year is null or birth_year = extract(year from date_of_birth))
);

create index people_branch_id_idx on public.people (branch_id);

-- What a Viewer may see. Managers and Administrators see the whole family.
create table public.access_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  scope public.grant_scope not null,
  branch_id uuid references public.branches (id) on delete cascade,
  created_at timestamptz not null default now(),
  check ((scope = 'branch') = (branch_id is not null)),
  unique (user_id, scope, branch_id)
);

create index access_grants_user_id_idx on public.access_grants (user_id);

-- Append-only record of changes. user_id has no foreign key.
create table public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid,
  action text not null,
  table_name text,
  record_id text,
  detail jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Access helpers (private schema: not exposed through the Supabase API)
-- ---------------------------------------------------------------------------

create function private.this_family_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select family_id from public.family_settings where singleton;
$$;

create function private.hub_issuer()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select hub_issuer from public.family_settings where singleton;
$$;

create function private.has_aal2()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

-- The signed-in user's effective role in THIS family, after the two-factor
-- rules. Returns 'super_user', 'manager', 'administrator', 'viewer' or null.
create function private.my_role()
returns text
language sql
stable
set search_path = ''
as $$
  with c as (
    select
      auth.jwt() -> 'vs' ->> 'system_role' as system_role,
      auth.jwt() -> 'vs' -> 'families' ->> (private.this_family_id())::text as family_role,
      coalesce((auth.jwt() -> 'vs' ->> 'mfa')::boolean, false) as mfa,
      private.has_aal2() as aal2
  )
  select case
    when c.system_role = 'super_user' and c.aal2 then 'super_user'
    when c.family_role in ('manager', 'administrator') and c.aal2 then c.family_role
    when c.family_role = 'viewer' and (c.aal2 or not c.mfa) then 'viewer'
    else null
  end
  from c
  where auth.uid() is not null
    and auth.jwt() ->> 'iss' = private.hub_issuer();
$$;

create function private.can_edit()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(private.my_role() in ('super_user', 'manager', 'administrator'), false);
$$;

create function private.can_manage()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(private.my_role() in ('super_user', 'manager'), false);
$$;

-- True when the signed-in Viewer has a grant of this kind.
create function private.has_grant(target_scope public.grant_scope, target_branch uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.access_grants g
    where g.user_id = auth.uid()
      and g.scope = target_scope
      and (target_branch is null or g.branch_id = target_branch)
  );
$$;

-- May the signed-in user see this person?
create function private.can_see_person(p_branch uuid, p_user uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.can_edit()
    or (
      private.my_role() = 'viewer'
      and (
        private.has_grant('whole_family')
        or (p_branch is not null and private.has_grant('branch', p_branch))
        or (p_user = auth.uid() and private.has_grant('own_record'))
      )
    );
$$;

revoke all on all functions in schema private from public;
grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.family_settings enable row level security;
alter table public.branches enable row level security;
alter table public.people enable row level security;
alter table public.access_grants enable row level security;
alter table public.audit_log enable row level security;

-- family_settings: anyone with a role here can read it; only Super Users may
-- rename the family. The family id itself can never change (trigger below).
create policy "family_settings: read" on public.family_settings
  for select to authenticated using (private.my_role() is not null);
create policy "family_settings: super users rename" on public.family_settings
  for update to authenticated
  using (private.my_role() = 'super_user')
  with check (private.my_role() = 'super_user');

-- branches: everyone with a role sees the list of branches.
create policy "branches: read" on public.branches
  for select to authenticated using (private.my_role() is not null);
create policy "branches: editors add" on public.branches
  for insert to authenticated with check (private.can_edit());
create policy "branches: editors change" on public.branches
  for update to authenticated using (private.can_edit()) with check (private.can_edit());
create policy "branches: managers remove" on public.branches
  for delete to authenticated using (private.can_manage());

-- people
create policy "people: read" on public.people
  for select to authenticated using (private.can_see_person(branch_id, user_id));
create policy "people: editors add" on public.people
  for insert to authenticated with check (private.can_edit());
create policy "people: editors change" on public.people
  for update to authenticated using (private.can_edit()) with check (private.can_edit());
create policy "people: managers remove" on public.people
  for delete to authenticated using (private.can_manage());

-- access_grants: Managers manage; everyone may see their own grants.
create policy "access_grants: read" on public.access_grants
  for select to authenticated
  using (user_id = auth.uid() or private.can_manage());
create policy "access_grants: managers manage" on public.access_grants
  for all to authenticated
  using (private.can_manage())
  with check (private.can_manage());

-- audit_log: Managers and Super Users read. Nobody writes directly.
create policy "audit_log: managers read" on public.audit_log
  for select to authenticated using (private.can_manage());

revoke insert, update, delete, truncate on public.audit_log from anon, authenticated;
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- Change logging and safeguards
-- ---------------------------------------------------------------------------

create function private.log_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_log (user_id, action, table_name, record_id, detail)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(rec ->> 'id', rec ->> 'family_id'),
    case when tg_op = 'UPDATE' then jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new)) else rec end
  );
  return coalesce(new, old);
end;
$$;

create trigger family_settings_log after insert or update or delete on public.family_settings
  for each row execute function private.log_change();
create trigger branches_log after insert or update or delete on public.branches
  for each row execute function private.log_change();
create trigger people_log after insert or update or delete on public.people
  for each row execute function private.log_change();
create trigger access_grants_log after insert or update or delete on public.access_grants
  for each row execute function private.log_change();

create function private.audit_log_is_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'The audit log cannot be changed or deleted';
end;
$$;

create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function private.audit_log_is_append_only();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function private.audit_log_is_append_only();

create function private.family_id_is_fixed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.family_id is distinct from old.family_id
     or new.hub_issuer is distinct from old.hub_issuer then
    raise exception 'The family id and hub of this database cannot be changed';
  end if;
  return new;
end;
$$;

create trigger family_settings_fixed_id before update on public.family_settings
  for each row execute function private.family_id_is_fixed();

-- The settings row can be added once and never removed, so the database can
-- never be switched to another family or hub.
create function private.family_settings_is_permanent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'The family settings of this database cannot be removed or replaced';
end;
$$;

create trigger family_settings_no_delete before delete on public.family_settings
  for each row execute function private.family_settings_is_permanent();
create trigger family_settings_no_truncate before truncate on public.family_settings
  for each statement execute function private.family_settings_is_permanent();

-- Moving a person to another branch, or linking a person to someone's login,
-- changes what Viewers can see. That is access management, so only Managers
-- (and Super Users) may do it. Administrators may still place a NEW person in
-- a branch.
create function private.guard_person_visibility()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null or private.can_manage() then
    return new;
  end if;
  if tg_op = 'INSERT' and new.user_id is not null then
    raise exception 'Only a Manager can link a person to a login';
  end if;
  if tg_op = 'UPDATE' and (
    new.user_id is distinct from old.user_id
    or new.branch_id is distinct from old.branch_id
  ) then
    raise exception 'Only a Manager can move a person to another branch or change their login link';
  end if;
  return new;
end;
$$;

create trigger people_guard_visibility before insert or update on public.people
  for each row execute function private.guard_person_visibility();

-- Supabase's service_role (the secret key) gets full table access by default.
-- The app never uses it, and it may not touch the audit log or settings.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke insert, update, delete, truncate on public.audit_log from service_role;
    revoke insert, update, delete, truncate on public.family_settings from service_role;
  end if;
end
$$;

create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger people_updated_at before update on public.people
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Which family and which hub (filled in; these can never change)
-- ---------------------------------------------------------------------------

insert into public.family_settings (family_id, family_name, hub_issuer)
values (
  'ab3eacfa-f57f-43c1-afe0-f27f21407f0d',
  'Visser',
  'https://gpjdzhtcidjjmhyfbejx.supabase.co/auth/v1'
);

-- ---------------------------------------------------------------------------
-- 3. Fictional practice data
-- ---------------------------------------------------------------------------

insert into public.branches (name, description) values
  ('Pieter branch', 'Descendants of Pieter Visser'),
  ('Marieke branch', 'Descendants of Marieke van Dijk (born Visser)');

insert into public.people (member_type, full_names, surname, maiden_name, known_as, birth_year, three_circle_role, branch_id) values
  ('family', 'Johannes Hendrik', 'Visser', null, 'Hans', 1944, 'family_leader', null),
  ('family', 'Elisabeth Maria', 'Visser', 'Bakker', 'Lies', 1947, 'family_owner', null),
  ('family', 'Pieter Johannes', 'Visser', null, 'Pieter', 1972, 'family_employee',
     (select id from public.branches where name = 'Pieter branch')),
  ('family', 'Sanne', 'Visser', 'de Boer', 'Sanne', 1975, 'family_member',
     (select id from public.branches where name = 'Pieter branch')),
  ('family', 'Daan Pieter', 'Visser', null, 'Daan', 2001, 'family_owner',
     (select id from public.branches where name = 'Pieter branch')),
  ('family', 'Marieke Elisabeth', 'van Dijk', 'Visser', 'Marieke', 1976, 'family_owner',
     (select id from public.branches where name = 'Marieke branch')),
  ('family_not_succession', 'Thomas', 'van Dijk', null, 'Tom', 1974, 'family_member',
     (select id from public.branches where name = 'Marieke branch')),
  ('family', 'Lotte Marieke', 'van Dijk', null, 'Lotte', 2005, 'family_member',
     (select id from public.branches where name = 'Marieke branch')),
  ('non_family', 'Willem', 'Jansen', null, 'Willem', 1965, 'employee', null);

-- Check: 9 people in 2 branches.
select p.known_as, p.surname, p.member_type, p.three_circle_role, b.name as branch
from public.people p left join public.branches b on b.id = p.branch_id
order by p.birth_year;
