-- Projects (decision 2.1): what a project is about, its purpose and expected
-- outcomes, the stage it is at, and its goals; each goal is broken into
-- to-dos in the family's one to-do list (decision 2.6).
--
-- The owner's choices (4 Nov 2026):
--   - Progress: the project moves through stages (Idea, Planning, Under way,
--     Completed, Stopped); each goal shows how many of its to-dos are done.
--   - Shown as progress bars, with the numbers written out.
--   - A project is about the whole family, a branch or an entity. Viewers
--     who may see that see the project and its progress; the to-dos stay
--     with the team (Managers and Administrators), as all to-dos do.
--   - A goal can be led by anyone in the Tree; to-dos are given to someone
--     with a login.

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  purpose text, -- what the project is about
  outcomes text, -- what it should achieve
  stage text not null default 'idea' check (stage in ('idea', 'planning', 'under_way', 'completed', 'stopped')),
  entity_id uuid references public.entities (id) on delete restrict,
  branch_id uuid references public.branches (id) on delete restrict,
  lead_person_id uuid references public.people (id) on delete set null,
  owner_id uuid, -- a login: a Manager or Administrator of the family
  starts_on date,
  target_on date,
  finished_on date, -- when it was completed or stopped
  finished_note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(entity_id, branch_id) <= 1),
  check (target_on is null or starts_on is null or target_on >= starts_on),
  check ((stage in ('completed', 'stopped')) = (finished_on is not null))
);

create table public.project_goals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  description text,
  lead_person_id uuid references public.people (id) on delete set null,
  target_on date,
  achieved_on date,
  sort integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index project_goals_project on public.project_goals (project_id);

-- To-dos can belong to a goal (their topic is then "projects").
alter table public.todos drop constraint todos_topic_check;
alter table public.todos add constraint todos_topic_check
  check (topic in ('filings', 'meetings', 'resolutions', 'investments', 'property', 'projects', 'actions', 'other'));
alter table public.todos add column project_goal_id uuid references public.project_goals (id) on delete cascade;
alter table public.todos add constraint todos_goal_topic check (project_goal_id is null or topic = 'projects');
create index todos_goal on public.todos (project_goal_id);

-- ---------------------------------------------------------------------------
-- Rules

create function private.project_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := old.created_by;
    -- What a project is about decides who sees it.
    if auth.uid() is not null and not private.can_manage()
       and (new.entity_id is distinct from old.entity_id or new.branch_id is distinct from old.branch_id) then
      raise exception 'Projects: only a Manager can change what a project is about.';
    end if;
  end if;
  if new.stage in ('completed', 'stopped') then
    if tg_op = 'INSERT' or old.stage not in ('completed', 'stopped') then
      new.finished_on := coalesce(new.finished_on, (now() at time zone 'Europe/London')::date);
    end if;
    if new.finished_on > (now() at time zone 'Europe/London')::date then
      raise exception 'Projects: a project can''t be finished on a future date.';
    end if;
  else
    new.finished_on := null;
    new.finished_note := null;
  end if;
  return new;
end;
$$;
create trigger projects_rules before insert or update on public.projects
  for each row execute function private.project_rules();

create function private.project_goal_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.project_id <> old.project_id then
    raise exception 'Projects: a goal can''t be moved to another project.';
  end if;
  if new.achieved_on > (now() at time zone 'Europe/London')::date then
    raise exception 'Projects: a goal can''t be achieved on a future date.';
  end if;
  return new;
end;
$$;
create trigger project_goals_rules before insert or update on public.project_goals
  for each row execute function private.project_goal_rules();

-- A to-do in a goal is about the project: it can't be moved to another goal.
create function private.todo_goal_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.project_goal_id is distinct from old.project_goal_id then
    raise exception 'Projects: a to-do can''t be moved to another goal.';
  end if;
  return new;
end;
$$;
create trigger todos_goal_rules before update on public.todos
  for each row execute function private.todo_goal_rules();

-- ---------------------------------------------------------------------------
-- Who sees what

create function private.can_see_project_scope(p_entity uuid, p_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_entity is not null then private.can_see_entity_id(p_entity)
    when p_branch is not null then private.can_see_scope(p_branch)
    else private.can_edit() or (private.my_role() = 'viewer' and private.has_grant('whole_family'))
  end;
$$;

alter table public.projects enable row level security;
alter table public.project_goals enable row level security;

create policy "projects: read" on public.projects
  for select to authenticated using (private.can_see_project_scope(entity_id, branch_id));
create policy "project_goals: read" on public.project_goals
  for select to authenticated using (exists (select 1 from public.projects p where p.id = project_id));

do $$
declare
  t text;
begin
  foreach t in array array['projects', 'project_goals'] loop
    execute format('create policy "%1$s: editors add" on public.%1$I for insert to authenticated with check (private.can_edit())', t);
    execute format('create policy "%1$s: editors change" on public.%1$I for update to authenticated using (private.can_edit()) with check (private.can_edit())', t);
    -- No delete rule: a record is removed only by two people (removal requests).
    execute format('create trigger %1$s_log after insert or update or delete on public.%1$I for each row execute function private.log_change()', t);
    execute format('create trigger %1$s_updated_at before update on public.%1$I for each row execute function private.touch_updated_at()', t);
    execute format('revoke all on public.%1$I from anon', t);
  end loop;
end;
$$;

-- How many of each goal's to-dos are done. Viewers can't read to-dos, but
-- may see the progress of a project they may see: only the counts.
create function public.project_progress(p_project uuid)
returns table (goal_id uuid, total integer, done integer)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, count(t.id)::integer, count(t.id) filter (where t.status = 'done')::integer
  from public.project_goals g
  join public.projects p on p.id = g.project_id
  left join public.todos t on t.project_goal_id = g.id
  where g.project_id = p_project
    and private.my_role() is not null
    and private.can_see_project_scope(p.entity_id, p.branch_id)
  group by g.id;
$$;

revoke all on function private.project_rules(), private.project_goal_rules(), private.todo_goal_rules() from public;
revoke all on function private.can_see_project_scope(uuid, uuid) from public;
grant execute on function private.can_see_project_scope(uuid, uuid) to authenticated;
revoke all on function public.project_progress(uuid) from public, anon;
grant execute on function public.project_progress(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Two-person removal: projects and goals can be asked for (a project's goals
-- and to-dos go with it, and a copy is kept with the request).

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
    ('calendar_event_people', 'Person linked to a calendar entry', 'id'),
    ('risks', 'Risk', 'id'),
    ('risk_reviews', 'Draft risk rating', 'id'),
    ('projects', 'Project', 'id'),
    ('project_goals', 'Goal of a project', 'id')
  ) as v (table_name, label, key_column)
  where v.table_name = p_table;
$$;
revoke all on function private.removable(text) from public;

create or replace function private.removal_allowed(p_table text, p_id uuid, rec jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_table in ('entities', 'branches') and exists (
       select 1 from public.projects x where p_id in (x.entity_id, x.branch_id)) then
    raise exception 'Removal: there are projects about this. A Manager first changes what those projects are about, or asks for them to be removed.';
  end if;
  -- A rated risk stays in the register as a record; it is closed instead.
  if p_table = 'risks' and exists (select 1 from public.risk_reviews v where v.risk_id = p_id and v.status = 'approved') then
    raise exception 'Removal: this risk has an approved rating, which is kept as a record. Close the risk instead.';
  end if;
  if p_table in ('people', 'entities', 'branches') and exists (
       select 1 from public.risks r where p_id in (r.person_id, r.entity_id, r.branch_id)) then
    raise exception 'Removal: there are risks about this in the risk register. A Manager first changes what those risks are about, or asks for unrated ones to be removed.';
  end if;
  if p_table = 'risk_reviews' and rec->>'status' = 'approved' then
    raise exception 'Removal: an approved rating is kept as a record. Rate the risk again instead.';
  end if;
  if p_table in ('distributions', 'dividends') and rec->>'status' in ('declared', 'paid') then
    raise exception 'Removal: a declared distribution or dividend is kept as a record.';
  end if;
  if p_table in ('beneficiaries', 'beneficiary_class_members') and exists (
       select 1 from public.distributions d where d.beneficiary_id = p_id or d.class_member_id = p_id) then
    raise exception 'Removal: a distribution to this beneficiary is on record. End the beneficiary instead.';
  end if;
  if p_table in ('people', 'outside_organisations', 'entities') and exists (
       select 1 from public.dividend_payments x where p_id in (x.person_id, x.organisation_id, x.holder_entity_id)) then
    raise exception 'Removal: a dividend was paid to them, which is kept as a record.';
  end if;
  if p_table = 'appointments' and exists (select 1 from public.decisions d where d.appointment_id = p_id) then
    raise exception 'Removal: this appointment is named in a minute or written resolution (its removal or resignation), so it is kept.';
  end if;
  if p_table = 'share_transactions' and rec->>'status' <> 'draft' then
    raise exception 'Removal: an approved share transaction can''t be removed. Record another transaction to put it right.';
  end if;
  if p_table = 'entities' and exists (select 1 from public.share_transactions t where t.entity_id = p_id and t.status = 'approved') then
    raise exception 'Removal: this entity has an approved share register, which is kept as a record. Mark it as dissolved instead.';
  end if;
  if p_table = 'share_classes' and exists (select 1 from public.share_transactions t where t.class_id = p_id and t.status = 'approved') then
    raise exception 'Removal: this class has approved transactions, which are kept as a record.';
  end if;
  if p_table = 'entities' and exists (select 1 from public.appointments a where a.holder_entity_id = p_id and a.ceased_on is null) then
    raise exception 'Removal: this entity still holds a role in another of the family''s entities (for example as trustee or director). End that appointment first.';
  end if;
  if p_table = 'outside_organisations' and exists (select 1 from public.appointments a where a.organisation_id = p_id and a.ceased_on is null) then
    raise exception 'Removal: this service provider still holds a current appointment. End it first (Officers & appointments), then ask again.';
  end if;
  -- The minute book and the register of resolutions are kept for good.
  if p_table in ('entities', 'governance_bodies') and (
       exists (select 1 from public.meetings m where (m.entity_id = p_id or m.governance_body_id = p_id) and m.status = 'confirmed')
       or exists (select 1 from public.written_resolutions w where (w.entity_id = p_id or w.governance_body_id = p_id) and w.status = 'passed')) then
    raise exception 'Removal: this has confirmed minutes or passed resolutions, which are kept as a record.';
  end if;
  if p_table = 'meetings' and rec->>'status' = 'confirmed' then
    raise exception 'Removal: a confirmed meeting is kept in the minute book.';
  end if;
  if p_table = 'written_resolutions' and rec->>'status' = 'passed' then
    raise exception 'Removal: a passed resolution is kept in the register of resolutions.';
  end if;
  if p_table in ('meeting_attendees', 'decisions') and exists (select 1 from public.meetings m where m.id = (rec->>'meeting_id')::uuid and m.status = 'confirmed') then
    raise exception 'Removal: this belongs to a confirmed meeting, which is kept as a record.';
  end if;
  if p_table in ('resolution_signatories', 'decisions') and exists (
       select 1 from public.written_resolutions w where w.id = (rec->>'resolution_id')::uuid and w.status in ('circulated', 'passed')) then
    raise exception 'Removal: this belongs to a resolution that has been circulated, which is kept as a record.';
  end if;
  if p_table in ('people', 'outside_organisations', 'entities') and (
       exists (select 1 from public.meeting_attendees a join public.meetings m on m.id = a.meeting_id
               where p_id in (a.person_id, a.organisation_id, a.holder_entity_id) and m.status = 'confirmed')
       or exists (select 1 from public.resolution_signatories s join public.written_resolutions w on w.id = s.resolution_id
                  where p_id in (s.person_id, s.organisation_id, s.holder_entity_id) and w.status = 'passed')) then
    raise exception 'Removal: this is named in the minute book or the register of resolutions, which are kept as a record.';
  end if;
end;
$$;
revoke all on function private.removal_allowed(text, uuid, jsonb) from public;
