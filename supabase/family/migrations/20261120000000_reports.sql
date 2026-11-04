-- Reports: the family / branch timeline's own events, and "My records".
--
-- The owner's choices (4 Nov 2026):
--   - The timeline shows family life events (from the Tree), entities and
--     ownership, governance, and events added by hand; each kind can be
--     switched off.
--   - Registers: links to each entity's own registers, plus one page of
--     individuals and the offices they hold (or the officers of each entity).
--   - Viewers get a "My records" report.
--
-- Almost everything on the timeline is worked out from the records already
-- kept. Only turning points that aren't recorded anywhere else (a move, the
-- sale of the business, a family crisis) are added here, by Managers and
-- Administrators. They are seen like calendar entries: by whoever may see
-- what they are about (one about the whole family: the team and Viewers with
-- whole-family access), and only if they may also see every person linked.

create table public.timeline_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  happened_on date not null,
  -- How exact the date is: the day, the month or only the year.
  precision text not null default 'day' check (precision in ('day', 'month', 'year')),
  category text not null default 'family' check (category in ('family', 'business', 'governance', 'other')),
  details text,
  entity_id uuid references public.entities (id) on delete restrict,
  branch_id uuid references public.branches (id) on delete restrict,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(entity_id, branch_id) <= 1)
);
create index timeline_events_on on public.timeline_events (happened_on);

create table public.timeline_event_people (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.timeline_events (id) on delete cascade,
  -- Restrict: removing the person would otherwise show the event to people
  -- who couldn't see it before.
  person_id uuid not null references public.people (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (event_id, person_id)
);
create index timeline_event_people_person on public.timeline_event_people (person_id);

create function private.timeline_event_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := old.created_by;
    if auth.uid() is not null and not private.can_manage()
       and (new.entity_id is distinct from old.entity_id or new.branch_id is distinct from old.branch_id) then
      raise exception 'Timeline: only a Manager can change what an event is about.';
    end if;
  end if;
  if new.happened_on > (now() at time zone 'Europe/London')::date then
    raise exception 'Timeline: an event can''t be in the future. Future dates go in the calendar.';
  end if;
  return new;
end;
$$;
create trigger timeline_events_rules before insert or update on public.timeline_events
  for each row execute function private.timeline_event_rules();

create function private.timeline_people_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.event_id <> old.event_id or new.person_id <> old.person_id then
    raise exception 'Timeline: a link to a person can''t be moved. Add a new link and ask for the old one to be removed.';
  end if;
  return new;
end;
$$;
create trigger timeline_event_people_rules before update on public.timeline_event_people
  for each row execute function private.timeline_people_rules();

create function private.can_see_timeline_people(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_edit() or not exists (
    select 1 from public.timeline_event_people x where x.event_id = p_event and not private.can_see_person_id(x.person_id)
  );
$$;

alter table public.timeline_events enable row level security;
alter table public.timeline_event_people enable row level security;

create policy "timeline_events: read" on public.timeline_events
  for select to authenticated using (
    case
      when entity_id is not null then private.can_see_entity_id(entity_id)
      when branch_id is not null then private.can_see_scope(branch_id)
      else private.can_edit() or (private.my_role() = 'viewer' and private.has_grant('whole_family'))
    end
    and private.can_see_timeline_people(id)
  );
create policy "timeline_event_people: read" on public.timeline_event_people
  for select to authenticated using (
    exists (select 1 from public.timeline_events e where e.id = event_id) and private.can_see_person_id(person_id)
  );

do $$
declare
  t text;
begin
  foreach t in array array['timeline_events', 'timeline_event_people'] loop
    execute format('create policy "%1$s: editors add" on public.%1$I for insert to authenticated with check (private.can_edit())', t);
    execute format('create policy "%1$s: editors change" on public.%1$I for update to authenticated using (private.can_edit()) with check (private.can_edit())', t);
    -- No delete rule: a record is removed only by two people (removal requests).
    execute format('create trigger %1$s_log after insert or update or delete on public.%1$I for each row execute function private.log_change()', t);
    execute format('revoke all on public.%1$I from anon', t);
  end loop;
end;
$$;
create trigger timeline_events_updated_at before update on public.timeline_events
  for each row execute function private.touch_updated_at();

-- An event and the people it is about are saved together, so a private
-- event is never visible to the whole family, even for a moment.
create function public.add_timeline_event(p_event jsonb, p_people uuid[])
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.timeline_events (title, happened_on, precision, category, details, entity_id, branch_id)
  values (
    p_event ->> 'title', (p_event ->> 'happened_on')::date, coalesce(p_event ->> 'precision', 'day'),
    coalesce(p_event ->> 'category', 'family'), p_event ->> 'details',
    (p_event ->> 'entity_id')::uuid, (p_event ->> 'branch_id')::uuid
  )
  returning id into v_id;
  insert into public.timeline_event_people (event_id, person_id)
  select v_id, p from unnest(coalesce(p_people, '{}')) as p group by p;
  return v_id;
end;
$$;

-- "My records": what concerns the person linked to the signed-in login, even
-- where their access doesn't otherwise show the entity – their offices,
-- their shares, the trusts and foundations they benefit from, and what has
-- been paid to them. Only for someone whose own record they may see; nothing
-- about anyone else.
create function public.my_records()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid;
begin
  if auth.uid() is null or private.my_role() is null then
    return null;
  end if;
  select p.id into me from public.people p where p.user_id = auth.uid();
  if me is null then
    return jsonb_build_object('person_id', null, 'reason', 'not_linked');
  end if;
  if not private.can_see_person_id(me) then
    return jsonb_build_object('person_id', null, 'reason', 'not_allowed');
  end if;
  return jsonb_build_object(
    'person_id', me,
    'offices', coalesce((
      select jsonb_agg(jsonb_build_object('entity', e.name, 'role', a.role, 'appointed_on', a.appointed_on, 'ceased_on', a.ceased_on) order by a.ceased_on nulls first, e.name)
      from public.appointments a join public.entities e on e.id = a.entity_id
      where a.person_id = me), '[]'::jsonb),
    'holdings', coalesce((
      select jsonb_agg(jsonb_build_object('entity', h.entity, 'class', h.class, 'shares', h.shares) order by h.entity, h.class)
      from (
        select min(e.name) as entity, min(c.name) as class,
          sum(case when t.to_person_id = me then t.shares else 0 end) - sum(case when t.from_person_id = me then t.shares else 0 end) as shares
        from public.share_transactions t
        join public.entities e on e.id = t.entity_id
        join public.share_classes c on c.id = t.class_id
        where t.status = 'approved' and t.kind in ('issue', 'transfer') and me in (t.to_person_id, t.from_person_id)
        group by t.entity_id, t.class_id
      ) h where h.shares > 0), '[]'::jsonb),
    'benefits', coalesce((
      select jsonb_agg(x order by x->>'entity') from (
        select jsonb_build_object('entity', e.name, 'as', 'Named beneficiary', 'interest', b.interest, 'from', b.added_on, 'to', b.ceased_on) as x
        from public.beneficiaries b join public.entities e on e.id = b.entity_id where b.person_id = me
        union all
        select jsonb_build_object('entity', e.name, 'as', 'Member of the class ‘' || k.name || '’', 'interest', null, 'from', m.added_on, 'to', m.ceased_on)
        from public.beneficiary_class_members m
        join public.beneficiary_classes k on k.id = m.class_id
        join public.entities e on e.id = m.entity_id
        where m.person_id = me
      ) s), '[]'::jsonb),
    'distributions', coalesce((
      select jsonb_agg(jsonb_build_object('entity', e.name, 'amount', d.amount, 'currency', d.currency, 'pool', d.pool, 'status', d.status, 'declared_on', d.declared_on, 'paid_on', d.paid_on) order by coalesce(d.paid_on, d.declared_on) desc)
      from public.distributions d
      join public.entities e on e.id = d.entity_id
      left join public.beneficiaries b on b.id = d.beneficiary_id
      left join public.beneficiary_class_members m on m.id = d.class_member_id
      where d.status in ('declared', 'paid') and me in (b.person_id, m.person_id)), '[]'::jsonb),
    'dividends', coalesce((
      select jsonb_agg(jsonb_build_object('entity', e.name, 'class', c.name, 'shares', p.shares, 'amount', p.amount, 'currency', v.currency, 'kind', v.kind, 'status', v.status, 'paid_on', p.paid_on, 'payment_date', v.payment_date) order by coalesce(p.paid_on, v.payment_date) desc)
      from public.dividend_payments p
      join public.dividends v on v.id = p.dividend_id
      join public.entities e on e.id = v.entity_id
      join public.share_classes c on c.id = v.class_id
      where p.person_id = me and v.status in ('declared', 'paid')), '[]'::jsonb)
  );
end;
$$;

revoke all on function private.timeline_event_rules(), private.timeline_people_rules() from public;
revoke all on function private.can_see_timeline_people(uuid) from public;
grant execute on function private.can_see_timeline_people(uuid) to authenticated;
revoke all on function public.add_timeline_event(jsonb, uuid[]), public.my_records() from public, anon;
grant execute on function public.add_timeline_event(jsonb, uuid[]), public.my_records() to authenticated;

-- Timeline events can be removed (by two people) like everything else.
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
    ('project_goals', 'Goal of a project', 'id'),
    ('timeline_events', 'Timeline event', 'id'),
    ('timeline_event_people', 'Person linked to a timeline event', 'id')
  ) as v (table_name, label, key_column)
  where v.table_name = p_table;
$$;
revoke all on function private.removable(text) from public;
