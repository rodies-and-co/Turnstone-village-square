-- Turnstone Village Square: The Organisation, step 1 (family database)
--
-- The family's entities (companies, trusts, foundations, LLCs, partnerships),
-- the outside organisations that serve them (trust companies, registered
-- agents, corporate directors, auditors), and the officers and appointments.
--
-- Each entity is matched to an Entity Standard kept in the hub, by
-- jurisdiction, entity type and sub-type. standard_id records the standard
-- that applied when it was matched (the hub keeps every version).
--
-- Who sees what: Managers and Administrators see every entity. Viewers see
-- entities only with whole-family access, or with access to the branch the
-- entity belongs to. Managers and Administrators add and change; only
-- Managers remove.

create function private.can_see_entity_branch(p_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_edit()
    or (private.my_role() = 'viewer'
        and (private.has_grant('whole_family') or (p_branch is not null and private.has_grant('branch', p_branch))));
$$;
revoke all on function private.can_see_entity_branch(uuid) from public;
grant execute on function private.can_see_entity_branch(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Outside organisations: each recorded once, used wherever needed.

create table public.outside_organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  kind text not null default 'other'
    check (kind in ('trust_company', 'registered_agent', 'corporate_services', 'management_company', 'law_firm',
                    'accounting_firm', 'bank', 'company', 'other')),
  jurisdiction text,
  registration_number text,
  address_id uuid references public.addresses (id) on delete set null,
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (phone is null or phone ~ '^\+?[0-9 ()-]{6,20}$'),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index outside_organisations_name on public.outside_organisations (lower(name));

-- ---------------------------------------------------------------------------
-- Entities

create table public.entities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  entity_type text not null check (entity_type in ('company', 'trust', 'foundation', 'llc', 'partnership')),
  jurisdiction text not null check (length(trim(jurisdiction)) > 0),
  sub_type text not null check (length(trim(sub_type)) > 0),
  standard_id uuid, -- an Entity Standard in the hub
  registration_number text,
  registered_on date,
  registered_address_id uuid references public.addresses (id) on delete set null,
  activity text,
  year_end_month integer check (year_end_month between 1 and 12),
  year_end_day integer check (year_end_day between 1 and 31),
  base_currency text check (base_currency is null or base_currency ~ '^[A-Z]{3}$'),
  family_contact_id uuid references public.people (id) on delete set null,
  branch_id uuid references public.branches (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'dormant', 'dissolved')),
  dissolved_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((year_end_month is null) = (year_end_day is null)),
  check (status = 'dissolved' or dissolved_on is null)
);
create unique index entities_name on public.entities (lower(name));

-- ---------------------------------------------------------------------------
-- Officers and appointments: held by a person in the Tree or an outside
-- organisation, never both.

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  role text not null check (role in (
    'director', 'alternate_director', 'secretary', 'nominated_officer', 'registered_agent', 'management_company',
    'public_officer', 'auditor', 'accounting_officer', 'trustee', 'protector', 'enforcer', 'council_member',
    'designated_member', 'member', 'manager', 'general_partner', 'limited_partner')),
  person_id uuid references public.people (id) on delete cascade,
  organisation_id uuid references public.outside_organisations (id) on delete cascade,
  resident boolean not null default false, -- resident in the entity's jurisdiction
  identity_verified boolean not null default false,
  licensed boolean not null default false, -- e.g. a licensed trust company
  appointed_on date,
  ceased_on date,
  notes text,
  created_at timestamptz not null default now(),
  check ((person_id is null) <> (organisation_id is null)),
  check (ceased_on is null or appointed_on is null or ceased_on >= appointed_on)
);
create index appointments_entity on public.appointments (entity_id);
create unique index appointments_current on public.appointments
  (entity_id, role, coalesce(person_id, organisation_id)) where ceased_on is null;

-- ---------------------------------------------------------------------------
-- Row-level security

alter table public.outside_organisations enable row level security;
alter table public.entities enable row level security;
alter table public.appointments enable row level security;

create policy "outside_organisations: read" on public.outside_organisations
  for select to authenticated using (private.my_role() is not null);
create policy "entities: read" on public.entities
  for select to authenticated using (private.can_see_entity_branch(branch_id));
create policy "appointments: read" on public.appointments
  for select to authenticated using (
    exists (select 1 from public.entities e where e.id = entity_id and private.can_see_entity_branch(e.branch_id))
    and (person_id is null or private.can_see_person_id(person_id))
  );

do $$
declare
  t text;
begin
  foreach t in array array['outside_organisations', 'entities', 'appointments'] loop
    execute format('create policy "%1$s: editors add" on public.%1$I for insert to authenticated with check (private.can_edit())', t);
    execute format('create policy "%1$s: editors change" on public.%1$I for update to authenticated using (private.can_edit()) with check (private.can_edit())', t);
    execute format('create policy "%1$s: managers remove" on public.%1$I for delete to authenticated using (private.can_manage())', t);
    execute format('create trigger %1$s_log after insert or update or delete on public.%1$I for each row execute function private.log_change()', t);
    execute format('revoke all on public.%1$I from anon', t);
  end loop;
end;
$$;

create trigger outside_organisations_updated_at before update on public.outside_organisations
  for each row execute function private.touch_updated_at();
create trigger entities_updated_at before update on public.entities
  for each row execute function private.touch_updated_at();
