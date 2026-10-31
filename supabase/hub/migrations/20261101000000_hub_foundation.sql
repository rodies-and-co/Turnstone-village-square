-- Turnstone Village Square: central hub foundation
--
-- The hub holds no family records. It holds:
--   families       - the list of families and where each family's own
--                    database lives (URL and publishable key, both public-safe)
--   staff          - Turnstone people with a system role (Super User, System Admin)
--   family_access  - who may open which family, and in which role
--                    (Manager, Administrator, Viewer)
--   audit_log      - append-only record of changes to the above
--
-- Every table has row-level security (RLS). Super Users and System Admins must
-- have completed two-factor (aal2) before they can see anything. Managers and
-- Administrators must have completed two-factor before they can open a family.
-- Viewers (family members, advisers) may skip two-factor, but once they have
-- set it up they must use it.
--
-- custom_access_token_hook adds each user's roles to their sign-in token, so
-- each family's own database can check access without calling the hub.

create schema if not exists private;

create type public.system_role as enum ('super_user', 'system_admin');
create type public.family_role as enum ('manager', 'administrator', 'viewer');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One row per family. On this table, `id` is the family_id used everywhere,
-- including inside that family's own database.
create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  status text not null default 'active' check (status in ('active', 'archived')),
  -- Where the family's own Supabase project lives. Both values are public-safe
  -- (the publishable key only works together with a signed-in user's token).
  -- Never store a secret or service-role key here.
  database_url text check (database_url is null or database_url ~ '^https://[a-z0-9-]+\.supabase\.co$'),
  database_publishable_key text check (
    database_publishable_key is null
    or database_publishable_key like 'sb_publishable_%'
  ),
  created_at timestamptz not null default now()
);

-- Turnstone people with a system role. Family roles are in family_access.
create table public.staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (length(trim(display_name)) > 0),
  system_role public.system_role,
  created_at timestamptz not null default now()
);

-- Who may open which family, and in what role.
create table public.family_access (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.family_role not null,
  created_at timestamptz not null default now(),
  unique (family_id, user_id)
);

create index family_access_user_id_idx on public.family_access (user_id);

-- Append-only. user_id has no foreign key so entries outlive deleted accounts.
create table public.audit_log (
  id bigint generated always as identity primary key,
  family_id uuid,
  user_id uuid,
  action text not null,
  table_name text,
  record_id text,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_family_id_idx on public.audit_log (family_id);

-- ---------------------------------------------------------------------------
-- Access helpers (private schema: not exposed through the Supabase API)
-- ---------------------------------------------------------------------------

create function private.has_aal2()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

create function private.has_verified_mfa(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.mfa_factors f
    where f.user_id = target_user and f.status = 'verified'
  );
$$;

-- The signed-in user's system role, only once they have completed two-factor.
create function private.my_system_role()
returns public.system_role
language sql
stable
security definer
set search_path = ''
as $$
  select s.system_role from public.staff s
  where s.user_id = auth.uid() and private.has_aal2();
$$;

create function private.is_super_user()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(private.my_system_role() = 'super_user', false);
$$;

create function private.is_system_staff()
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.my_system_role() is not null;
$$;

-- The signed-in user's role in a family, applying the two-factor rules.
create function private.my_family_role(target_family uuid)
returns public.family_role
language sql
stable
security definer
set search_path = ''
as $$
  select a.role from public.family_access a
  join public.families f on f.id = a.family_id and f.status = 'active'
  where a.family_id = target_family
    and a.user_id = auth.uid()
    and (
      private.has_aal2()
      or (a.role = 'viewer' and not private.has_verified_mfa(auth.uid()))
    );
$$;

-- Who may give, change or remove a family role:
-- - Super Users: anyone, any role.
-- - System Admins: anyone except themselves and other Turnstone staff with a
--   system role, any role.
-- - Managers: Administrators and Viewers in their own family, except
--   themselves and staff with a system role.
-- Nobody but a Super User may change their own access, so a System Admin
-- cannot make themselves a Manager and read family records.
create function private.can_manage_access(
  target_family uuid,
  target_role public.family_role,
  target_user uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_user()
    or (
      target_user is distinct from auth.uid()
      and not exists (
        select 1 from public.staff s
        where s.user_id = target_user and s.system_role is not null
      )
      and (
        private.my_system_role() = 'system_admin'
        or (
          private.my_family_role(target_family) = 'manager'
          and target_role in ('administrator', 'viewer')
        )
      )
    );
$$;

revoke all on all functions in schema private from public;
grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;
-- Only the token hook needs this one; it takes any user id.
revoke execute on function private.has_verified_mfa(uuid) from authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.families enable row level security;
alter table public.staff enable row level security;
alter table public.family_access enable row level security;
alter table public.audit_log enable row level security;

-- families
create policy "families: staff and members can see" on public.families
  for select to authenticated
  using (private.is_system_staff() or private.my_family_role(id) is not null);

create policy "families: super users add" on public.families
  for insert to authenticated
  with check (private.is_super_user());

-- Only Super Users may change a family, including where its database lives.
-- (A wrong address would send people's sign-in tokens to the wrong place.)
create policy "families: super users update" on public.families
  for update to authenticated
  using (private.is_super_user())
  with check (private.is_super_user());

create policy "families: super users delete" on public.families
  for delete to authenticated
  using (private.is_super_user());

-- staff
create policy "staff: see yourself, system staff see all" on public.staff
  for select to authenticated
  using (user_id = auth.uid() or private.is_system_staff());

create policy "staff: super users manage" on public.staff
  for all to authenticated
  using (private.is_super_user())
  with check (private.is_super_user());

-- family_access
create policy "family_access: see own, managers see their family, staff see all"
  on public.family_access
  for select to authenticated
  using (
    user_id = auth.uid()
    or private.is_system_staff()
    or private.my_family_role(family_id) = 'manager'
  );

create policy "family_access: add" on public.family_access
  for insert to authenticated
  with check (private.can_manage_access(family_id, role, user_id));

create policy "family_access: change" on public.family_access
  for update to authenticated
  using (private.can_manage_access(family_id, role, user_id))
  with check (private.can_manage_access(family_id, role, user_id));

create policy "family_access: remove" on public.family_access
  for delete to authenticated
  using (private.can_manage_access(family_id, role, user_id));

-- audit_log: read by system staff only. No insert/update/delete policies, so
-- nobody can write to it directly; triggers write through SECURITY DEFINER.
create policy "audit_log: system staff read" on public.audit_log
  for select to authenticated
  using (private.is_system_staff());

revoke insert, update, delete, truncate on public.audit_log from anon, authenticated;
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- Change logging
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
  insert into public.audit_log (family_id, user_id, action, table_name, record_id, detail)
  values (
    case
      when tg_table_name = 'families' then (rec ->> 'id')::uuid
      else nullif(rec ->> 'family_id', '')::uuid
    end,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(rec ->> 'id', rec ->> 'user_id'),
    case when tg_op = 'UPDATE' then jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new)) else rec end
  );
  return coalesce(new, old);
end;
$$;

create trigger families_log after insert or update or delete on public.families
  for each row execute function private.log_change();
create trigger staff_log after insert or update or delete on public.staff
  for each row execute function private.log_change();
create trigger family_access_log after insert or update or delete on public.family_access
  for each row execute function private.log_change();

-- Audit entries can never be changed or removed through the app or the API.
-- (A database owner could still switch triggers off; that itself is visible.)
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

-- Supabase's service_role (the secret key) gets full table access by default.
-- The app never uses it, and it may not touch the audit log.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke insert, update, delete, truncate on public.audit_log from service_role;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Sign-in token hook
--
-- Supabase calls this every time it issues a sign-in token. It adds:
--   vs.system_role  - 'super_user', 'system_admin' or null
--   vs.families     - { "<family id>": "manager" | "administrator" | "viewer" }
--   vs.mfa          - true when the user has two-factor set up
-- Each family database reads these claims (together with the token's own
-- aal claim) to decide what the user may see. Changes to access take effect
-- the next time the token refreshes, so keep the token lifetime short.
-- ---------------------------------------------------------------------------

create function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (event ->> 'user_id')::uuid;
  claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  families jsonb;
  sys_role text;
begin
  select coalesce(jsonb_object_agg(a.family_id::text, a.role::text), '{}'::jsonb)
    into families
  from public.family_access a
  join public.families f on f.id = a.family_id and f.status = 'active'
  where a.user_id = uid;

  select s.system_role::text into sys_role from public.staff s where s.user_id = uid;

  claims := jsonb_set(
    claims,
    '{vs}',
    jsonb_build_object(
      'system_role', sys_role,
      'families', families,
      'mfa', private.has_verified_mfa(uid)
    )
  );

  return jsonb_build_object('claims', claims);
end;
$$;

revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant usage on schema private to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant execute on function private.has_verified_mfa(uuid) to supabase_auth_admin;
-- The hook runs as its owner (SECURITY DEFINER), so supabase_auth_admin needs
-- no direct access to the tables.
