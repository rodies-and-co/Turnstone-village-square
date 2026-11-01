-- Turnstone Village Square: governance, advisors, purpose and values
-- (family database)
--
-- From the plan ("The Branches"): record the family's governance structure
-- (Family Assembly, Family Council and so on), the circles of advisors (per
-- family and per branch, with what each advises on - decision 2.4), and the
-- family's governance measures: purpose, values, arrangements and guidance.
--
-- Everything here is either for the whole family (branch_id is null) or for
-- one branch. Who sees what:
--   - whole-family items: everyone with a role in this family;
--   - branch items: Managers, Administrators, and Viewers with access to the
--     whole family or to that branch.
-- Managers and Administrators add and change; only Managers remove.
--
-- Purpose, values and other statements are prepared, then adopted. Whoever
-- prepared the wording can't be the one who adopts it, and only a Manager
-- adopts. Changing the wording of an adopted statement makes it a draft again.

-- ---------------------------------------------------------------------------
-- Who may see an item for the whole family (null) or for a branch.
create function private.can_see_scope(p_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_branch is null then private.my_role() is not null
    else private.can_edit()
      or (private.my_role() = 'viewer'
          and (private.has_grant('whole_family') or private.has_grant('branch', p_branch)))
  end;
$$;
revoke all on function private.can_see_scope(uuid) from public;
grant execute on function private.can_see_scope(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Governance bodies and their members

create table public.governance_bodies (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('family_assembly', 'family_council', 'branch_council', 'board', 'committee', 'other')),
  name text not null check (length(trim(name)) > 0),
  branch_id uuid references public.branches (id) on delete cascade,
  purpose text,
  meets text, -- e.g. "Twice a year"
  established_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Names are unique within the whole family's bodies, and within each branch's.
create unique index governance_bodies_name on public.governance_bodies
  (coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

create table public.body_members (
  id uuid primary key default gen_random_uuid(),
  body_id uuid not null references public.governance_bodies (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  role text not null default 'member'
    check (role in ('chair', 'vice_chair', 'secretary', 'member', 'branch_representative', 'independent', 'observer')),
  from_date date,
  to_date date,
  created_at timestamptz not null default now(),
  check (to_date is null or from_date is null or to_date >= from_date)
);
-- A person holds one current seat on a body.
create unique index body_members_current on public.body_members (body_id, person_id) where to_date is null;

-- ---------------------------------------------------------------------------
-- Circles of advisors: the advisor once, then what they advise on, for the
-- whole family or a branch.

create table public.advisors (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) > 0),
  firm text,
  profession text not null default 'other'
    check (profession in ('lawyer', 'accountant', 'tax_adviser', 'wealth_manager', 'fiduciary', 'banker',
                          'family_business_adviser', 'facilitator', 'insurance', 'other')),
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (phone is null or phone ~ '^\+?[0-9 ()-]{6,20}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.advisor_roles (
  id uuid primary key default gen_random_uuid(),
  advisor_id uuid not null references public.advisors (id) on delete cascade,
  branch_id uuid references public.branches (id) on delete cascade,
  advises_on text not null check (length(trim(advises_on)) > 0),
  from_date date,
  to_date date,
  created_at timestamptz not null default now(),
  check (to_date is null or from_date is null or to_date >= from_date)
);

-- ---------------------------------------------------------------------------
-- Purpose, values and other statements

create table public.family_statements (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('purpose', 'vision', 'mission', 'values', 'arrangement', 'guidance')),
  branch_id uuid references public.branches (id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  body text not null check (length(trim(body)) > 0),
  status text not null default 'draft' check (status in ('draft', 'adopted')),
  prepared_by uuid default auth.uid(),
  adopted_by uuid,
  adopted_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'adopted') = (adopted_by is not null and adopted_on is not null))
);

-- Prepare, then adopt (by someone else, a Manager).
create function private.statement_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'adopted' then
      raise exception 'Statement: a new statement starts as a draft. Someone else adopts it.';
    end if;
    new.prepared_by := auth.uid();
    new.adopted_by := null;
    new.adopted_on := null;
    return new;
  end if;

  -- Who prepared it never changes except by changing the wording, and the
  -- adoption details are only ever set below. Nobody can set them directly.
  new.prepared_by := old.prepared_by;
  new.adopted_by := old.adopted_by;
  new.adopted_on := old.adopted_on;

  -- New wording is a new draft, prepared by whoever changed it.
  if new.title is distinct from old.title or new.body is distinct from old.body or new.kind is distinct from old.kind
     or new.branch_id is distinct from old.branch_id then
    new.status := 'draft';
    new.prepared_by := auth.uid();
    new.adopted_by := null;
    new.adopted_on := null;
    return new;
  end if;

  if new.status = 'adopted' and old.status = 'draft' then
    if not private.can_manage() then
      raise exception 'Statement: only a Manager can adopt a statement.';
    end if;
    if auth.uid() is null or auth.uid() is not distinct from old.prepared_by then
      raise exception 'Statement: whoever prepared a statement can''t also adopt it. Ask another Manager.';
    end if;
    new.adopted_by := auth.uid();
    new.adopted_on := current_date;
  elsif new.status = 'draft' and old.status = 'adopted' then
    if not private.can_manage() then
      raise exception 'Statement: only a Manager can withdraw an adopted statement.';
    end if;
    new.adopted_by := null;
    new.adopted_on := null;
  end if;
  return new;
end;
$$;

create trigger family_statements_rules before insert or update on public.family_statements
  for each row execute function private.statement_rules();

-- ---------------------------------------------------------------------------
-- Row-level security

alter table public.governance_bodies enable row level security;
alter table public.body_members enable row level security;
alter table public.advisors enable row level security;
alter table public.advisor_roles enable row level security;
alter table public.family_statements enable row level security;

create policy "governance_bodies: read" on public.governance_bodies
  for select to authenticated using (private.can_see_scope(branch_id));
create policy "body_members: read" on public.body_members
  for select to authenticated using (
    private.can_see_person_id(person_id)
    and exists (select 1 from public.governance_bodies b where b.id = body_id and private.can_see_scope(b.branch_id))
  );
-- Advisors are professionals: anyone with a role may see who they are. What
-- they advise a branch on follows the branch.
create policy "advisors: read" on public.advisors
  for select to authenticated using (private.my_role() is not null);
create policy "advisor_roles: read" on public.advisor_roles
  for select to authenticated using (private.can_see_scope(branch_id));
create policy "family_statements: read" on public.family_statements
  for select to authenticated using (private.can_see_scope(branch_id));

do $$
declare
  t text;
begin
  foreach t in array array['governance_bodies', 'body_members', 'advisors', 'advisor_roles', 'family_statements'] loop
    execute format('create policy "%1$s: editors add" on public.%1$I for insert to authenticated with check (private.can_edit())', t);
    execute format('create policy "%1$s: editors change" on public.%1$I for update to authenticated using (private.can_edit()) with check (private.can_edit())', t);
    execute format('create policy "%1$s: managers remove" on public.%1$I for delete to authenticated using (private.can_manage())', t);
    execute format('create trigger %1$s_log after insert or update or delete on public.%1$I for each row execute function private.log_change()', t);
  end loop;
end;
$$;

create trigger governance_bodies_updated_at before update on public.governance_bodies
  for each row execute function private.touch_updated_at();
create trigger advisors_updated_at before update on public.advisors
  for each row execute function private.touch_updated_at();
create trigger family_statements_updated_at before update on public.family_statements
  for each row execute function private.touch_updated_at();

revoke all on function private.statement_rules() from public;
