-- Turnstone Village Square: Organising – the one to-do list and the calendar
-- (family database)
--
-- The owner's choices (3 Nov 2026):
--   - One to-do list (decision 2.6). Besides to-dos people add, it shows
--     what the records say needs doing: filings and notices due, meetings to
--     confirm and minutes to approve, resolutions waiting for signatures,
--     distributions and dividends to pay, approvals and removals waiting, and
--     gaps in each entity's setup. Those are worked out, not stored here.
--   - A to-do is given to someone with a login (a Manager or Administrator of
--     the family, or the Super User); the hub lists who that can be.
--   - The calendar is kept in Village Square and also shows on each person's
--     record in the Tree.
--   - Email reminders come later, with the family's email sender.
--
-- To-dos are working notes for the people who run the family's records, so
-- only Managers and Administrators see them. Calendar entries follow who may
-- see what they are about: an entity, a branch, the whole family, and any
-- people linked to them.

create table public.todos (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  details text,
  topic text not null default 'actions' check (topic in ('filings', 'meetings', 'resolutions', 'investments', 'property', 'actions', 'other')),
  priority text not null default 'normal' check (priority in ('high', 'normal', 'low')),
  due_on date,
  assigned_to uuid, -- a login (from the hub's family team); empty: not given to anyone yet
  entity_id uuid references public.entities (id) on delete cascade,
  person_id uuid references public.people (id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'done')),
  done_by uuid,
  done_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'done') = (done_at is not null))
);
create index todos_entity on public.todos (entity_id);
create index todos_person on public.todos (person_id);
create index todos_assigned on public.todos (assigned_to) where status = 'open';

create function private.todo_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    if new.status = 'done' then
      new.done_by := coalesce(auth.uid(), new.done_by);
      new.done_at := coalesce(new.done_at, now());
    else
      new.done_by := null;
      new.done_at := null;
    end if;
    return new;
  end if;
  new.created_by := old.created_by;
  if new.status = 'done' and old.status = 'open' then
    new.done_by := auth.uid();
    new.done_at := now();
  elsif new.status = 'open' then
    new.done_by := null;
    new.done_at := null;
  else
    new.done_by := old.done_by;
    new.done_at := old.done_at;
  end if;
  return new;
end;
$$;
create trigger todos_rules before insert or update on public.todos
  for each row execute function private.todo_rules();

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  kind text not null default 'family' check (kind in ('family', 'personal', 'deadline', 'reminder', 'other')),
  starts_on date not null,
  ends_on date,
  starts_at time,
  location text,
  details text,
  entity_id uuid references public.entities (id) on delete cascade,
  branch_id uuid references public.branches (id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on),
  check (num_nonnulls(entity_id, branch_id) <= 1)
);
create index calendar_events_starts on public.calendar_events (starts_on);

create table public.calendar_event_people (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.calendar_events (id) on delete cascade,
  -- Restrict: removing the person would otherwise quietly show the entry to
  -- people who couldn't see it before. Remove the entry (or the link) first.
  person_id uuid not null references public.people (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (event_id, person_id)
);
create index calendar_event_people_person on public.calendar_event_people (person_id);

create function private.calendar_event_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := old.created_by;
    -- Changing what an entry is about changes who sees it, so (as with
    -- placing a person in a branch) only a Manager may do it.
    if auth.uid() is not null and not private.can_manage()
       and (new.entity_id is distinct from old.entity_id or new.branch_id is distinct from old.branch_id) then
      raise exception 'Calendar: only a Manager can change what an entry is about.';
    end if;
  end if;
  return new;
end;
$$;
create trigger calendar_events_rules before insert or update on public.calendar_events
  for each row execute function private.calendar_event_rules();

-- A link to a person can be added or removed (by two people), never moved.
create function private.calendar_event_people_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.event_id <> old.event_id or new.person_id <> old.person_id then
    raise exception 'Calendar: a link to a person can''t be moved. Add a new link and ask for the old one to be removed.';
  end if;
  return new;
end;
$$;
create trigger calendar_event_people_rules before update on public.calendar_event_people
  for each row execute function private.calendar_event_people_rules();

-- An entry is seen by whoever may see what it is about, and every person
-- linked to it.
create function private.can_see_event_people(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_edit() or not exists (
    select 1 from public.calendar_event_people x where x.event_id = p_event and not private.can_see_person_id(x.person_id)
  );
$$;

alter table public.todos enable row level security;
alter table public.calendar_events enable row level security;
alter table public.calendar_event_people enable row level security;

create policy "todos: editors read" on public.todos
  for select to authenticated using (private.can_edit());
create policy "calendar_events: read" on public.calendar_events
  for select to authenticated using (
    case
      when entity_id is not null then private.can_see_entity_id(entity_id)
      when branch_id is not null then private.can_see_scope(branch_id)
      else private.my_role() is not null
    end
    and private.can_see_event_people(id)
  );
create policy "calendar_event_people: read" on public.calendar_event_people
  for select to authenticated using (
    exists (select 1 from public.calendar_events e where e.id = event_id) and private.can_see_person_id(person_id)
  );

do $$
declare
  t text;
begin
  foreach t in array array['todos', 'calendar_events', 'calendar_event_people'] loop
    execute format('create policy "%1$s: editors add" on public.%1$I for insert to authenticated with check (private.can_edit())', t);
    execute format('create policy "%1$s: editors change" on public.%1$I for update to authenticated using (private.can_edit()) with check (private.can_edit())', t);
    -- No delete rule: a record is removed only by two people (removal requests).
    execute format('create trigger %1$s_log after insert or update or delete on public.%1$I for each row execute function private.log_change()', t);
    execute format('revoke all on public.%1$I from anon', t);
  end loop;
end;
$$;
create trigger todos_updated_at before update on public.todos
  for each row execute function private.touch_updated_at();
create trigger calendar_events_updated_at before update on public.calendar_events
  for each row execute function private.touch_updated_at();

revoke all on function private.todo_rules(), private.calendar_event_rules(), private.calendar_event_people_rules() from public;

-- An entry and the people it is about are saved together, so a private entry
-- is never visible to the whole family, even for a moment. Runs with the
-- caller's own rights, so the rules above all apply.
create function public.add_calendar_event(p_event jsonb, p_people uuid[])
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.calendar_events (title, kind, starts_on, ends_on, starts_at, location, details, entity_id, branch_id)
  values (
    p_event ->> 'title',
    coalesce(p_event ->> 'kind', 'family'),
    (p_event ->> 'starts_on')::date,
    (p_event ->> 'ends_on')::date,
    (p_event ->> 'starts_at')::time,
    p_event ->> 'location',
    p_event ->> 'details',
    (p_event ->> 'entity_id')::uuid,
    (p_event ->> 'branch_id')::uuid
  )
  returning id into v_id;
  insert into public.calendar_event_people (event_id, person_id)
  select v_id, p from unnest(coalesce(p_people, '{}')) as p group by p;
  return v_id;
end;
$$;
revoke all on function public.add_calendar_event(jsonb, uuid[]) from public, anon;
grant execute on function public.add_calendar_event(jsonb, uuid[]) to authenticated;
revoke all on function private.can_see_event_people(uuid) from public;
grant execute on function private.can_see_event_people(uuid) to authenticated;

-- To-dos and calendar entries can be removed (by two people) like everything else.
create or replace function private.removable(p_table text)
returns table (label text, key_column text)
language sql
immutable
set search_path = ''
as $$
  select v.label, v.key_column from (values
    ('people', 'Person', 'id'),
    ('branches', 'Branch', 'id'),
    ('addresses', 'Address', 'id'),
    ('person_details', 'Personal details', 'person_id'),
    ('passports', 'Passport', 'id'),
    ('tax_numbers', 'Tax number', 'id'),
    ('phone_numbers', 'Phone number', 'id'),
    ('person_addresses', 'Address of a person', 'id'),
    ('parent_child', 'Family link (parent and child)', 'id'),
    ('partnerships', 'Marriage or partnership', 'id'),
    ('wealth_creators', 'Wealth creator mark', 'person_id'),
    ('branch_answers', 'Answer to a branch question', 'id'),
    ('governance_bodies', 'Governance body', 'id'),
    ('body_members', 'Membership of a governance body', 'id'),
    ('advisors', 'Advisor', 'id'),
    ('advisor_roles', 'Place in a circle of advisors', 'id'),
    ('family_statements', 'Statement', 'id'),
    ('outside_organisations', 'Outside organisation', 'id'),
    ('entities', 'Entity', 'id'),
    ('appointments', 'Appointment', 'id'),
    ('share_classes', 'Share class', 'id'),
    ('share_transactions', 'Draft share transaction', 'id'),
    ('settlements', 'Settlement', 'id'),
    ('beneficiaries', 'Beneficiary', 'id'),
    ('beneficiary_classes', 'Class of beneficiaries', 'id'),
    ('beneficiary_class_members', 'Member of a class of beneficiaries', 'id'),
    ('compliance_filings', 'Filing record', 'id'),
    ('meetings', 'Meeting', 'id'),
    ('meeting_attendees', 'Person at a meeting', 'id'),
    ('written_resolutions', 'Written resolution', 'id'),
    ('resolution_signatories', 'Signatory of a resolution', 'id'),
    ('decisions', 'Decision', 'id'),
    ('file_notes', 'File note', 'id'),
    ('file_note_people', 'Person linked to a file note', 'id'),
    ('distributions', 'Proposed distribution', 'id'),
    ('dividends', 'Proposed dividend', 'id'),
    ('todos', 'To-do', 'id'),
    ('calendar_events', 'Calendar entry', 'id'),
    ('calendar_event_people', 'Person linked to a calendar entry', 'id')
  ) as v (table_name, label, key_column)
  where v.table_name = p_table;
$$;
revoke all on function private.removable(text) from public;
