-- Turnstone Village Square: the Tree (one family's database)
--
-- Adds to each person:
--   person_details   - full date of birth, place of birth, sex, email, date of
--                      death, relationship to wealth, psychometric consent date
--   passports        - country, number, expiry (repeats)
--   tax_numbers      - country, number (repeats)
--   phone_numbers    - label, number (repeats)
--   addresses        - the family's one shared address list (no duplicates)
--   person_addresses - which address a person uses, and for what
--   parent_child     - family links: parent and child
--   partnerships     - marriages, civil partnerships and partners
--
-- Who sees what:
--   people, parent_child, partnerships: as before (Managers, Administrators,
--     Super Users see everyone; Viewers see who their grants allow).
--   person_details, passports, tax_numbers, phone_numbers, person_addresses,
--     addresses: personal details. Only Managers, Administrators, Super Users,
--     and the person themself (a Viewer whose login is linked to the record).
-- Managers, Administrators and Super Users may add and change. Only Managers
-- and Super Users may remove. Every change is logged.

-- Move the full date of birth out of people: it is a personal detail. The
-- birth year stays on people, so everyone allowed to see a person can tell
-- people with the same "Known as" apart.
create table public.person_details (
  person_id uuid primary key references public.people (id) on delete cascade,
  date_of_birth date,
  city_of_birth text,
  country_of_birth text,
  sex text not null default 'unspecified' check (sex in ('female', 'male', 'other', 'unspecified')),
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  date_of_death date,
  relationship_to_wealth text check (
    relationship_to_wealth is null
    or relationship_to_wealth in ('immigrant', 'native', 'married_in', 'mixed')
  ),
  psychometric_consent_date date,
  updated_at timestamptz not null default now(),
  check (date_of_death is null or date_of_birth is null or date_of_death >= date_of_birth)
);

insert into public.person_details (person_id, date_of_birth)
select id, date_of_birth from public.people where date_of_birth is not null;

alter table public.people drop constraint if exists people_check;
alter table public.people drop column date_of_birth;

-- Keep the birth year in step with the date of birth.
create function private.sync_birth_year()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.date_of_birth is not null then
    update public.people
    set birth_year = extract(year from new.date_of_birth)::integer
    where id = new.person_id
      and birth_year is distinct from extract(year from new.date_of_birth)::integer;
  end if;
  return new;
end;
$$;

create trigger person_details_birth_year after insert or update of date_of_birth on public.person_details
  for each row execute function private.sync_birth_year();

-- And the other way: once a date of birth is recorded, the year on the
-- person's record always follows it, whatever is typed in the Overview.
create function private.birth_year_from_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  dob date;
begin
  select d.date_of_birth into dob from public.person_details d where d.person_id = new.id;
  if dob is not null then
    new.birth_year := extract(year from dob)::integer;
  end if;
  return new;
end;
$$;

create trigger people_birth_year_follows_details before update of birth_year on public.people
  for each row execute function private.birth_year_from_details();

create table public.passports (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  country text not null check (length(trim(country)) > 0),
  number text not null check (length(trim(number)) > 0),
  expires_on date,
  created_at timestamptz not null default now()
);
create index passports_person_idx on public.passports (person_id);

create table public.tax_numbers (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  country text not null check (length(trim(country)) > 0),
  number text not null check (length(trim(number)) > 0),
  created_at timestamptz not null default now()
);
create index tax_numbers_person_idx on public.tax_numbers (person_id);

create table public.phone_numbers (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  label text not null default 'Mobile' check (length(trim(label)) > 0),
  number text not null check (number ~ '^\+?[0-9 ()-]{6,20}$'),
  created_at timestamptz not null default now()
);
create index phone_numbers_person_idx on public.phone_numbers (person_id);

-- The family's one address list. The same address is stored once and reused.
create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  line1 text not null check (length(trim(line1)) > 0),
  line2 text,
  city text not null check (length(trim(city)) > 0),
  region text,
  postal_code text,
  country text not null check (length(trim(country)) > 0),
  match_key text generated always as (
    lower(regexp_replace(
      line1 || coalesce(line2, '') || city || coalesce(postal_code, '') || country,
      '[^a-zA-Z0-9]+', '', 'g'
    ))
  ) stored unique,
  created_at timestamptz not null default now()
);

create table public.person_addresses (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  address_id uuid not null references public.addresses (id) on delete restrict,
  kind text not null default 'home' check (kind in ('home', 'postal', 'work', 'other')),
  is_current boolean not null default true,
  from_date date,
  to_date date,
  created_at timestamptz not null default now(),
  unique (person_id, address_id, kind),
  check (to_date is null or from_date is null or to_date >= from_date)
);
create index person_addresses_person_idx on public.person_addresses (person_id);

create table public.parent_child (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.people (id) on delete cascade,
  child_id uuid not null references public.people (id) on delete cascade,
  kind text not null default 'birth' check (kind in ('birth', 'adopted', 'step', 'foster')),
  created_at timestamptz not null default now(),
  unique (parent_id, child_id),
  check (parent_id <> child_id)
);
create index parent_child_child_idx on public.parent_child (child_id);

create table public.partnerships (
  id uuid primary key default gen_random_uuid(),
  person_a uuid not null references public.people (id) on delete cascade,
  person_b uuid not null references public.people (id) on delete cascade,
  kind text not null default 'marriage' check (kind in ('marriage', 'civil_partnership', 'partner')),
  start_date date,
  end_date date,
  end_reason text check (end_reason is null or end_reason in ('divorce', 'separation', 'death')),
  created_at timestamptz not null default now(),
  check (person_a <> person_b),
  check (end_date is null or start_date is null or end_date >= start_date),
  check ((end_reason is null) or (end_date is not null))
);
-- Each partnership is stored once (the pair is put in a fixed order first).
-- The same couple may still have a second marriage with another start date.
create unique index partnerships_once on public.partnerships (person_a, person_b, kind, coalesce(start_date, 'infinity'::date));
create index partnerships_a_idx on public.partnerships (person_a);
create index partnerships_b_idx on public.partnerships (person_b);

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------

-- May the signed-in user see this person? (Reads the person's branch and
-- login link itself, so it can be used on tables that only hold person_id.)
create function private.can_see_person_id(p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.people p
    where p.id = p_person and private.can_see_person(p.branch_id, p.user_id)
  );
$$;

-- May the signed-in user see this person's personal details? Editors, and the
-- person themself (if their access grants let them see their own record).
create function private.can_see_private(p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_edit()
    or (
      private.my_role() = 'viewer'
      and exists (
        select 1 from public.people p
        where p.id = p_person and p.user_id = auth.uid()
          and private.can_see_person(p.branch_id, p.user_id)
      )
    );
$$;

-- May the signed-in user see this shared address? Editors, and a Viewer whose
-- own record uses it.
create function private.can_see_address(p_address uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_edit()
    or (
      private.my_role() = 'viewer'
      and exists (
        select 1 from public.person_addresses pa
        join public.people p on p.id = pa.person_id
        where pa.address_id = p_address and p.user_id = auth.uid()
          and private.can_see_person(p.branch_id, p.user_id)
      )
    );
$$;

revoke all on function private.can_see_person_id(uuid), private.can_see_private(uuid),
  private.can_see_address(uuid), private.sync_birth_year(), private.birth_year_from_details() from public;
grant execute on function private.can_see_person_id(uuid), private.can_see_private(uuid),
  private.can_see_address(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.person_details enable row level security;
alter table public.passports enable row level security;
alter table public.tax_numbers enable row level security;
alter table public.phone_numbers enable row level security;
alter table public.addresses enable row level security;
alter table public.person_addresses enable row level security;
alter table public.parent_child enable row level security;
alter table public.partnerships enable row level security;

-- Personal details: read by editors and the person; add and change by
-- editors; remove by Managers.
do $$
declare t text;
begin
  foreach t in array array['person_details', 'passports', 'tax_numbers', 'phone_numbers', 'person_addresses']
  loop
    execute format('create policy "%1$s: read" on public.%1$I for select to authenticated using (private.can_see_private(person_id))', t);
    execute format('create policy "%1$s: editors add" on public.%1$I for insert to authenticated with check (private.can_edit())', t);
    execute format('create policy "%1$s: editors change" on public.%1$I for update to authenticated using (private.can_edit()) with check (private.can_edit())', t);
    execute format('create policy "%1$s: managers remove" on public.%1$I for delete to authenticated using (private.can_manage())', t);
  end loop;
end
$$;

create policy "addresses: read" on public.addresses
  for select to authenticated using (private.can_see_address(id));
create policy "addresses: editors add" on public.addresses
  for insert to authenticated with check (private.can_edit());
create policy "addresses: editors change" on public.addresses
  for update to authenticated using (private.can_edit()) with check (private.can_edit());
create policy "addresses: managers remove" on public.addresses
  for delete to authenticated using (private.can_manage());

-- Family links: visible when the user may see both people.
create policy "parent_child: read" on public.parent_child
  for select to authenticated
  using (private.can_see_person_id(parent_id) and private.can_see_person_id(child_id));
create policy "parent_child: editors add" on public.parent_child
  for insert to authenticated with check (private.can_edit());
create policy "parent_child: editors change" on public.parent_child
  for update to authenticated using (private.can_edit()) with check (private.can_edit());
create policy "parent_child: managers remove" on public.parent_child
  for delete to authenticated using (private.can_manage());

create policy "partnerships: read" on public.partnerships
  for select to authenticated
  using (private.can_see_person_id(person_a) and private.can_see_person_id(person_b));
create policy "partnerships: editors add" on public.partnerships
  for insert to authenticated with check (private.can_edit());
create policy "partnerships: editors change" on public.partnerships
  for update to authenticated using (private.can_edit()) with check (private.can_edit());
create policy "partnerships: managers remove" on public.partnerships
  for delete to authenticated using (private.can_manage());

revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- Safeguards and logging
-- ---------------------------------------------------------------------------

-- Nobody can be their own ancestor.
create function private.no_family_loops()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    with recursive ancestors(id) as (
      select new.parent_id
      union
      select pc.parent_id from public.parent_child pc join ancestors a on pc.child_id = a.id
    )
    select 1 from ancestors where id = new.child_id
  ) then
    raise exception 'This link would make a person their own ancestor';
  end if;
  return new;
end;
$$;

create trigger parent_child_no_loops before insert or update on public.parent_child
  for each row execute function private.no_family_loops();

-- A person can have at most two birth parents.
create function private.at_most_two_birth_parents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'birth' and (
    select count(*) from public.parent_child
    where child_id = new.child_id and kind = 'birth' and id <> new.id
  ) >= 2 then
    raise exception 'A person can have at most two birth parents';
  end if;
  return new;
end;
$$;

create trigger parent_child_two_birth_parents before insert or update on public.parent_child
  for each row execute function private.at_most_two_birth_parents();

-- Store each partnership once, whichever way round it is entered.
create function private.partnership_order()
returns trigger
language plpgsql
set search_path = ''
as $$
declare tmp uuid;
begin
  if new.person_a > new.person_b then
    tmp := new.person_a;
    new.person_a := new.person_b;
    new.person_b := tmp;
  end if;
  return new;
end;
$$;

create trigger partnerships_order before insert or update on public.partnerships
  for each row execute function private.partnership_order();

create trigger person_details_updated_at before update on public.person_details
  for each row execute function private.touch_updated_at();

do $$
declare t text;
begin
  foreach t in array array['person_details', 'passports', 'tax_numbers', 'phone_numbers', 'addresses',
                           'person_addresses', 'parent_child', 'partnerships']
  loop
    execute format('create trigger %1$s_log after insert or update or delete on public.%1$I for each row execute function private.log_change()', t);
  end loop;
end
$$;

-- log_change records the row's id; person_details has none, so use person_id.
create or replace function private.log_change()
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
    coalesce(rec ->> 'id', rec ->> 'person_id', rec ->> 'family_id'),
    case when tg_op = 'UPDATE' then jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new)) else rec end
  );
  return coalesce(new, old);
end;
$$;
