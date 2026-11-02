-- Turnstone Village Square: meetings, written resolutions and file notes
-- (family database)
--
-- Decision 1.1: one Decision record; only passed decisions change registers;
-- a minute book, a register of written resolutions and a decisions register.
-- The owner's choices (2 Nov 2026):
--   - Who decides: an entity's board (directors, trustees, council, managers,
--     general partners), an entity's members (shareholders), and the family's
--     governance bodies (Family Council, Assembly, branch councils…).
--   - Signatures are recorded (who signed and when), not signed in the app.
--   - Share transactions and appointments need a passed decision from now
--     on (or the entity's formation documents, or a deed of appointment).
--     Records made before this are marked "earlier".
--   - The quorum is set per entity (from its articles) and per body.
--
-- A meeting: planned, then held (attendance and the outcome of each decision
-- recorded), then confirmed by a Manager who didn't record it. Only then do
-- its carried decisions count, from the date of the meeting, and only if a
-- quorum was present. The minutes are drafted, circulated and approved
-- (usually signed by the chair of the next meeting) separately.
--
-- A written resolution: drafted, circulated to everyone entitled to vote,
-- signed (each signature recorded with its date), then confirmed as passed by
-- a Manager who didn't prepare it. A board resolution needs every member of
-- the board; members' and governance resolutions may need all, a majority or
-- three quarters. It passes on the date the last needed signature was given.
--
-- A file note records a fact or a discussion. It needs no approval.

-- ---------------------------------------------------------------------------
-- 1. Quorums

alter table public.entities
  add column board_quorum_rule text check (board_quorum_rule in ('number', 'majority', 'all')),
  add column board_quorum_number integer check (board_quorum_number > 0),
  add column members_quorum_rule text check (members_quorum_rule in ('number', 'majority', 'all')),
  add column members_quorum_number integer check (members_quorum_number > 0),
  add constraint entities_board_quorum check ((board_quorum_rule = 'number') = (board_quorum_number is not null)),
  add constraint entities_members_quorum check ((members_quorum_rule = 'number') = (members_quorum_number is not null));

alter table public.governance_bodies
  add column quorum_rule text check (quorum_rule in ('number', 'majority', 'all')),
  add column quorum_number integer check (quorum_number > 0),
  add constraint governance_bodies_quorum check ((quorum_rule = 'number') = (quorum_number is not null));

-- ---------------------------------------------------------------------------
-- 2. Who may vote, on a given day

-- The roles that make up an entity's board.
create function private.board_roles()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['director', 'trustee', 'council_member', 'manager', 'general_partner', 'designated_member'];
$$;

-- Votes a holder had in an entity on a day: shares of voting classes, from
-- the approved transactions up to that day.
create function private.votes_held(p_entity uuid, p_person uuid, p_org uuid, p_holder_entity uuid, p_on date)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case
    when t.to_person_id is not distinct from p_person and t.to_organisation_id is not distinct from p_org
         and t.to_entity_id is not distinct from p_holder_entity then t.shares
    else -t.shares end), 0)::bigint
  from public.share_transactions t
  join public.share_classes c on c.id = t.class_id and c.voting
  where t.entity_id = p_entity and t.status = 'approved' and t.kind in ('issue', 'transfer') and t.transaction_date <= p_on
    and (
      (t.to_person_id is not distinct from p_person and t.to_organisation_id is not distinct from p_org and t.to_entity_id is not distinct from p_holder_entity)
      or (t.kind = 'transfer' and t.from_person_id is not distinct from p_person and t.from_organisation_id is not distinct from p_org
          and t.from_entity_id is not distinct from p_holder_entity)
    );
$$;

-- Everyone entitled to vote for a body on a day, with their votes (one each,
-- or their voting shares for members).
create function private.voters(p_body text, p_entity uuid, p_gov uuid, p_on date)
returns table (person_id uuid, organisation_id uuid, holder_entity_id uuid, votes bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct a.person_id, a.organisation_id, a.holder_entity_id, 1::bigint
  from public.appointments a
  where p_body = 'board' and a.entity_id = p_entity and a.role = any (private.board_roles())
    and (a.appointed_on is null or a.appointed_on <= p_on) and (a.ceased_on is null or a.ceased_on > p_on)
  union all
  select h.p, h.o, h.e, h.v from (
    select x.p, x.o, x.e, private.votes_held(p_entity, x.p, x.o, x.e, p_on) as v
    from (
      select distinct t.to_person_id as p, t.to_organisation_id as o, t.to_entity_id as e
      from public.share_transactions t
      where p_body = 'members' and t.entity_id = p_entity and t.status = 'approved' and t.kind in ('issue', 'transfer')
    ) x
  ) h
  where h.v > 0
  union all
  select distinct m.person_id, null::uuid, null::uuid, 1::bigint
  from public.body_members m
  where p_body = 'governance' and m.body_id = p_gov and m.role <> 'observer'
    and (m.from_date is null or m.from_date <= p_on) and (m.to_date is null or m.to_date > p_on);
$$;

create function private.is_voter(p_body text, p_entity uuid, p_gov uuid, p_person uuid, p_org uuid, p_holder_entity uuid, p_on date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.voters(p_body, p_entity, p_gov, p_on) v
    where v.person_id is not distinct from p_person and v.organisation_id is not distinct from p_org
      and v.holder_entity_id is not distinct from p_holder_entity
  );
$$;

-- May the signed-in user see a body's meetings and resolutions?
create function private.can_see_body(p_body text, p_entity uuid, p_gov uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_body = 'governance' then exists (select 1 from public.governance_bodies b where b.id = p_gov and private.can_see_scope(b.branch_id))
    else private.can_see_entity_id(p_entity)
  end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Meetings

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  body text not null check (body in ('board', 'members', 'governance')),
  entity_id uuid references public.entities (id) on delete cascade,
  governance_body_id uuid references public.governance_bodies (id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  meeting_on date not null,
  starts_at time,
  location text,
  video_link text check (video_link is null or video_link ~ '^https://'),
  agenda text,
  status text not null default 'planned' check (status in ('planned', 'held', 'confirmed', 'cancelled')),
  quorum_met boolean,
  number integer check (number > 0), -- in the minute book, given when the record is confirmed
  minutes text,
  minutes_status text not null default 'draft' check (minutes_status in ('draft', 'circulated', 'approved')),
  minutes_approved_on date,
  minutes_signed_by uuid references public.people (id) on delete set null,
  minutes_written_by uuid[] not null default '{}', -- whoever wrote or changed the minutes: none of them may record them as approved
  prepared_by uuid,
  edited_by uuid[] not null default '{}', -- everyone who recorded or changed it: none of them may confirm it
  confirmed_by uuid,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((body = 'governance') = (governance_body_id is not null)),
  check ((body = 'governance') = (entity_id is null)),
  check (status <> 'confirmed' or (number is not null and quorum_met is not null)),
  check (minutes_status <> 'approved' or (status = 'confirmed' and minutes_approved_on is not null)),
  check (minutes_approved_on is null or minutes_approved_on >= meeting_on)
);
create index meetings_entity on public.meetings (entity_id);
create index meetings_governance_body on public.meetings (governance_body_id);
create unique index meetings_number on public.meetings (body, coalesce(entity_id, governance_body_id), number);

create table public.meeting_attendees (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  person_id uuid references public.people (id) on delete cascade,
  organisation_id uuid references public.outside_organisations (id) on delete cascade,
  holder_entity_id uuid references public.entities (id) on delete cascade,
  represented_by text, -- who attended for a firm or an entity
  capacity text not null default 'voting' check (capacity in ('voting', 'in_attendance')),
  attendance text not null default 'present' check (attendance in ('present', 'apologies', 'absent')),
  is_chair boolean not null default false,
  created_at timestamptz not null default now(),
  check (num_nonnulls(person_id, organisation_id, holder_entity_id) = 1),
  check (capacity = 'voting' or attendance = 'present'),
  check (not is_chair or attendance = 'present')
);
create unique index meeting_attendees_once on public.meeting_attendees (meeting_id, coalesce(person_id, organisation_id, holder_entity_id));
create unique index meeting_attendees_one_chair on public.meeting_attendees (meeting_id) where is_chair;

-- ---------------------------------------------------------------------------
-- 4. Written resolutions

create table public.written_resolutions (
  id uuid primary key default gen_random_uuid(),
  body text not null check (body in ('board', 'members', 'governance')),
  entity_id uuid references public.entities (id) on delete cascade,
  governance_body_id uuid references public.governance_bodies (id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  background text,
  required text not null default 'all' check (required in ('all', 'majority', 'three_quarters')),
  status text not null default 'draft' check (status in ('draft', 'circulated', 'passed', 'lapsed')),
  circulated_on date,
  passed_on date,
  number integer check (number > 0), -- in the register of written resolutions, given when it passes
  prepared_by uuid,
  edited_by uuid[] not null default '{}',
  confirmed_by uuid,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((body = 'governance') = (governance_body_id is not null)),
  check ((body = 'governance') = (entity_id is null)),
  check (body <> 'board' or required = 'all'),
  check (status = 'draft' or circulated_on is not null),
  check ((status = 'passed') = (passed_on is not null and number is not null)),
  check (passed_on is null or passed_on >= circulated_on)
);
create index written_resolutions_entity on public.written_resolutions (entity_id);
create index written_resolutions_governance_body on public.written_resolutions (governance_body_id);
create unique index written_resolutions_number on public.written_resolutions (body, coalesce(entity_id, governance_body_id), number);

create table public.resolution_signatories (
  id uuid primary key default gen_random_uuid(),
  resolution_id uuid not null references public.written_resolutions (id) on delete cascade,
  person_id uuid references public.people (id) on delete cascade,
  organisation_id uuid references public.outside_organisations (id) on delete cascade,
  holder_entity_id uuid references public.entities (id) on delete cascade,
  signed_for_by text, -- who signed for a firm or an entity
  votes bigint not null default 1 check (votes > 0), -- set when it is circulated
  signed_on date,
  created_at timestamptz not null default now(),
  check (num_nonnulls(person_id, organisation_id, holder_entity_id) = 1)
);
create unique index resolution_signatories_once on public.resolution_signatories (resolution_id, coalesce(person_id, organisation_id, holder_entity_id));

-- ---------------------------------------------------------------------------
-- 5. Decisions: the items of a meeting or a written resolution

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references public.meetings (id) on delete cascade,
  resolution_id uuid references public.written_resolutions (id) on delete cascade,
  item integer not null check (item > 0),
  title text not null check (length(trim(title)) > 0),
  background text,
  wording text not null check (length(trim(wording)) > 0), -- "It was resolved that…"
  outcome text not null default 'proposed' check (outcome in ('proposed', 'carried', 'not_carried', 'withdrawn')),
  votes_for integer check (votes_for >= 0),
  votes_against integer check (votes_against >= 0),
  abstentions integer check (abstentions >= 0),
  passed_on date, -- set only when the meeting is confirmed or the resolution passes
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(meeting_id, resolution_id) = 1),
  check (passed_on is null or outcome = 'carried')
);
create unique index decisions_meeting_item on public.decisions (meeting_id, item) where meeting_id is not null;
create unique index decisions_resolution_item on public.decisions (resolution_id, item) where resolution_id is not null;

-- ---------------------------------------------------------------------------
-- 6. File notes

create table public.file_notes (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references public.entities (id) on delete cascade,
  governance_body_id uuid references public.governance_bodies (id) on delete cascade,
  branch_id uuid references public.branches (id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  kind text not null default 'other' check (kind in ('phone_call', 'meeting', 'email', 'visit', 'other')),
  noted_on date not null default current_date,
  noted_at time,
  body text not null check (length(trim(body)) > 0),
  written_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(entity_id, governance_body_id, branch_id) <= 1)
);
create index file_notes_entity on public.file_notes (entity_id);

create table public.file_note_people (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.file_notes (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (note_id, person_id)
);

-- ---------------------------------------------------------------------------
-- 7. The rules

-- Quorum of a meeting: who could vote, who was there to vote, and how many
-- were needed (from the entity's or body's quorum).
create function private.meeting_quorum(p_meeting uuid)
returns table (entitled integer, present integer, needed integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m public.meetings;
  rule text;
  n integer;
begin
  select * into m from public.meetings where id = p_meeting;
  entitled := (select count(*) from private.voters(m.body, m.entity_id, m.governance_body_id, m.meeting_on));
  -- Only those entitled to vote on the day count, checked again now (an
  -- appointment or the meeting date may have changed since they were added).
  present := (select count(*) from public.meeting_attendees a
              where a.meeting_id = p_meeting and a.capacity = 'voting' and a.attendance = 'present'
                and private.is_voter(m.body, m.entity_id, m.governance_body_id, a.person_id, a.organisation_id, a.holder_entity_id, m.meeting_on));
  if m.body = 'board' then
    select e.board_quorum_rule, e.board_quorum_number into rule, n from public.entities e where e.id = m.entity_id;
  elsif m.body = 'members' then
    select e.members_quorum_rule, e.members_quorum_number into rule, n from public.entities e where e.id = m.entity_id;
  else
    select b.quorum_rule, b.quorum_number into rule, n from public.governance_bodies b where b.id = m.governance_body_id;
  end if;
  needed := case rule when 'number' then n when 'majority' then entitled / 2 + 1 when 'all' then entitled else null end;
  return next;
end;
$$;

-- The next number in a body's minute book or register of resolutions.
create function private.next_number(p_table text, p_body text, p_entity uuid, p_gov uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_table || p_body || coalesce(p_entity, p_gov)::text));
  execute format('select coalesce(max(number), 0) + 1 from public.%I where body = $1 and coalesce(entity_id, governance_body_id) = $2', p_table)
    into n using p_body, coalesce(p_entity, p_gov);
  return n;
end;
$$;

-- A members' body exists only for entities with shares.
create function private.check_body(p_body text, p_entity uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_body = 'members' and not exists (select 1 from public.entities e where e.id = p_entity and e.entity_type in ('company', 'llc')) then
    raise exception 'Meetings: only a company or an LLC has members who meet or sign resolutions.';
  end if;
end;
$$;

create function private.meeting_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  q record;
  frozen jsonb;
begin
  if auth.uid() is null then
    -- Set-up scripts run by the database owner.
    if new.status = 'confirmed' and new.number is null then
      new.number := private.next_number('meetings', new.body, new.entity_id, new.governance_body_id);
    end if;
    if new.status = 'confirmed' then
      new.quorum_met := coalesce(new.quorum_met, true);
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    perform private.check_body(new.body, new.entity_id);
    if new.status not in ('planned', 'held') then
      raise exception 'Meetings: a new meeting is planned, or recorded as held. Another Manager confirms the record.';
    end if;
    if new.minutes_status = 'approved' then
      raise exception 'Meetings: minutes are approved only after the record is confirmed.';
    end if;
    new.prepared_by := auth.uid();
    new.edited_by := array[auth.uid()];
    new.confirmed_by := null;
    new.confirmed_at := null;
    new.number := null;
    new.quorum_met := null;
  else
    -- Who prepared and confirmed it, and its number, are set only here.
    new.prepared_by := old.prepared_by;
    new.edited_by := old.edited_by;
    new.confirmed_by := old.confirmed_by;
    new.confirmed_at := old.confirmed_at;
    new.number := old.number;
    new.quorum_met := old.quorum_met;
    new.body := old.body;
    new.entity_id := old.entity_id;
    new.governance_body_id := old.governance_body_id;
    new.minutes_written_by := old.minutes_written_by;
    if new.minutes is distinct from old.minutes and not (auth.uid() = any (old.minutes_written_by)) then
      new.minutes_written_by := old.minutes_written_by || auth.uid();
    end if;
    if old.status = 'cancelled' and new.status not in ('cancelled', 'planned') then
      raise exception 'Meetings: a cancelled meeting can only be planned again.';
    end if;

    if old.status = 'confirmed' then
      if old.minutes_status = 'approved' and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
        raise exception 'Meetings: approved minutes can''t be changed.';
      end if;
      -- Only the minutes can still change, until they are approved.
      frozen := to_jsonb(old) - array['minutes', 'minutes_status', 'minutes_approved_on', 'minutes_signed_by', 'minutes_written_by', 'updated_at'];
      if (to_jsonb(new) - array['minutes', 'minutes_status', 'minutes_approved_on', 'minutes_signed_by', 'minutes_written_by', 'updated_at']) is distinct from frozen then
        raise exception 'Meetings: a confirmed meeting can''t be changed. Only its minutes can, until they are approved.';
      end if;
      if new.minutes_status = 'approved' and old.minutes_status <> 'approved' then
        if not private.can_manage() then
          raise exception 'Meetings: only a Manager can record the minutes as approved.';
        end if;
        if auth.uid() = any (new.minutes_written_by) then
          raise exception 'Meetings: whoever wrote or changed the minutes can''t also record them as approved. Ask another Manager.';
        end if;
        if new.minutes is distinct from old.minutes then
          raise exception 'Meetings: record the minutes as approved as they were circulated. Change them first, then ask another Manager.';
        end if;
      end if;
      return new;
    end if;

    if new.status = 'confirmed' then
      if old.status <> 'held' then
        raise exception 'Meetings: record the meeting as held (who was there and how each decision went) before it is confirmed.';
      end if;
      if not private.can_manage() then
        raise exception 'Meetings: only a Manager can confirm a meeting''s record.';
      end if;
      if auth.uid() is not distinct from old.prepared_by or auth.uid() = any (old.edited_by) then
        raise exception 'Meetings: whoever recorded a meeting can''t also confirm it. Ask another Manager.';
      end if;
      if (to_jsonb(new) - array['status', 'minutes', 'minutes_status', 'updated_at']) is distinct from (to_jsonb(old) - array['status', 'minutes', 'minutes_status', 'updated_at']) then
        raise exception 'Meetings: confirm the record as it was prepared. Change it first, then ask another Manager to confirm it.';
      end if;
      if exists (select 1 from public.decisions d where d.meeting_id = old.id and d.outcome = 'proposed') then
        raise exception 'Meetings: record how each decision went (carried, not carried or withdrawn) before confirming.';
      end if;
      select * into q from private.meeting_quorum(old.id);
      if q.needed is null then
        raise exception 'Meetings: the quorum isn''t recorded yet. Add it to the % first.',
          case when old.body = 'governance' then 'governance body (The Branches, Governance)' else 'entity''s details (Overview)' end;
      end if;
      new.quorum_met := q.present >= q.needed and q.present > 0;
      if not new.quorum_met and exists (select 1 from public.decisions d where d.meeting_id = old.id and d.outcome = 'carried') then
        raise exception 'Meetings: % of % entitled to vote were present, and % were needed. Without a quorum no decision can be carried: mark them not carried.',
          q.present, q.entitled, q.needed;
      end if;
      new.number := private.next_number('meetings', old.body, old.entity_id, old.governance_body_id);
      new.confirmed_by := auth.uid();
      new.confirmed_at := now();
      -- The carried decisions count from the date of the meeting.
      perform set_config('vs.passing', 'on', true);
      update public.decisions set passed_on = old.meeting_on where meeting_id = old.id and outcome = 'carried';
      perform set_config('vs.passing', 'off', true);
      return new;
    end if;

    -- A change by an editor: they become its preparer.
    new.prepared_by := auth.uid();
    if not (auth.uid() = any (old.edited_by)) then
      new.edited_by := old.edited_by || auth.uid();
    end if;
  end if;

  if new.status = 'held' and new.meeting_on > current_date then
    raise exception 'Meetings: a meeting can be recorded as held only on or after its date.';
  end if;
  if new.minutes_status = 'approved' then
    raise exception 'Meetings: minutes are approved only after the record is confirmed.';
  end if;
  return new;
end;
$$;

create trigger meetings_rules before insert or update on public.meetings
  for each row execute function private.meeting_rules();

-- Changing what belongs to a meeting or resolution counts as changing it:
-- whoever does it can't confirm it.
create function private.touch_parent(p_meeting uuid, p_resolution uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or current_setting('vs.passing', true) = 'on' then
    return;
  end if;
  if p_meeting is not null then
    update public.meetings set updated_at = now() where id = p_meeting;
  end if;
  if p_resolution is not null then
    update public.written_resolutions set updated_at = now() where id = p_resolution and status in ('draft', 'circulated');
  end if;
end;
$$;

create function private.attendee_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.meetings;
  r record := coalesce(new, old);
begin
  select * into m from public.meetings where id = r.meeting_id;
  if auth.uid() is not null then
    if m.status in ('confirmed', 'cancelled') then
      raise exception 'Meetings: who attended can''t change once the meeting is confirmed or cancelled.';
    end if;
    if tg_op <> 'DELETE' and new.capacity = 'voting'
       and not private.is_voter(m.body, m.entity_id, m.governance_body_id, new.person_id, new.organisation_id, new.holder_entity_id, m.meeting_on) then
      raise exception 'Meetings: only someone entitled to vote on % can attend as a voter. Add others as "in attendance".', to_char(m.meeting_on, 'DD/MM/YYYY');
    end if;
    if tg_op = 'UPDATE' and new.meeting_id <> old.meeting_id then
      raise exception 'Meetings: an attendee can''t be moved to another meeting.';
    end if;
  end if;
  perform private.touch_parent(r.meeting_id, null);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger meeting_attendees_rules before insert or update or delete on public.meeting_attendees
  for each row execute function private.attendee_rules();

create function private.decision_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record := coalesce(new, old);
  m public.meetings;
  w public.written_resolutions;
begin
  if current_setting('vs.passing', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' and (new.meeting_id is distinct from old.meeting_id or new.resolution_id is distinct from old.resolution_id) then
    raise exception 'Decisions: a decision can''t be moved to another meeting or resolution.';
  end if;
  if tg_op <> 'DELETE' and (tg_op = 'INSERT' or new.passed_on is distinct from old.passed_on) and new.passed_on is not null and auth.uid() is not null then
    raise exception 'Decisions: a decision counts as passed only when its meeting is confirmed or its resolution passes.';
  end if;
  if r.meeting_id is not null then
    select * into m from public.meetings where id = r.meeting_id;
    if auth.uid() is not null then
      if m.status in ('confirmed', 'cancelled') then
        raise exception 'Decisions: the decisions of a confirmed or cancelled meeting can''t change.';
      end if;
      if tg_op <> 'DELETE' and new.outcome in ('carried', 'not_carried') and m.status <> 'held' then
        raise exception 'Decisions: record the meeting as held before recording how a decision went.';
      end if;
    end if;
  else
    select * into w from public.written_resolutions where id = r.resolution_id;
    if auth.uid() is not null then
      if w.status <> 'draft' then
        raise exception 'Decisions: a resolution''s wording can''t change once it has been circulated.';
      end if;
      if tg_op <> 'DELETE' and new.outcome not in ('proposed', 'withdrawn') then
        raise exception 'Decisions: a written resolution''s decisions pass when it passes.';
      end if;
    end if;
  end if;
  if tg_op = 'INSERT' and auth.uid() is not null then
    new.passed_on := null;
  end if;
  perform private.touch_parent(r.meeting_id, r.resolution_id);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger decisions_rules before insert or update or delete on public.decisions
  for each row execute function private.decision_rules();

-- When a resolution passes: the date the last signature needed was given.
create function private.resolution_passes_on(p_resolution uuid)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w public.written_resolutions;
  total numeric;
  running numeric := 0;
  s record;
begin
  select * into w from public.written_resolutions where id = p_resolution;
  select coalesce(sum(votes), 0) into total from public.resolution_signatories where resolution_id = p_resolution;
  if total = 0 then
    return null;
  end if;
  for s in select signed_on, votes from public.resolution_signatories where resolution_id = p_resolution and signed_on is not null order by signed_on loop
    running := running + s.votes;
    if (w.required = 'all' and running = total)
       or (w.required = 'majority' and running * 2 > total)
       or (w.required = 'three_quarters' and running * 4 >= total * 3) then
      return s.signed_on;
    end if;
  end loop;
  return null;
end;
$$;

create function private.resolution_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  missing integer;
  passes date;
begin
  if auth.uid() is null then
    if new.status = 'passed' and new.number is null then
      new.number := private.next_number('written_resolutions', new.body, new.entity_id, new.governance_body_id);
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    perform private.check_body(new.body, new.entity_id);
    if new.status <> 'draft' then
      raise exception 'Resolutions: a resolution starts as a draft.';
    end if;
    new.prepared_by := auth.uid();
    new.edited_by := array[auth.uid()];
    new.confirmed_by := null;
    new.confirmed_at := null;
    new.number := null;
    new.passed_on := null;
    new.circulated_on := null;
    return new;
  end if;

  new.prepared_by := old.prepared_by;
  new.edited_by := old.edited_by;
  new.confirmed_by := old.confirmed_by;
  new.confirmed_at := old.confirmed_at;
  new.number := old.number;
  new.passed_on := old.passed_on;
  new.body := old.body;
  new.entity_id := old.entity_id;
  new.governance_body_id := old.governance_body_id;

  if old.status in ('passed', 'lapsed') then
    if (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
      raise exception 'Resolutions: a resolution that has passed or lapsed can''t be changed.';
    end if;
    return new;
  end if;

  if old.status = 'draft' and new.status = 'draft' then
    new.prepared_by := auth.uid();
    if not (auth.uid() = any (old.edited_by)) then
      new.edited_by := old.edited_by || auth.uid();
    end if;
    new.circulated_on := null;
    return new;
  end if;

  if old.status = 'draft' and new.status = 'circulated' then
    if (to_jsonb(new) - array['status', 'circulated_on', 'updated_at']) is distinct from (to_jsonb(old) - array['status', 'circulated_on', 'updated_at']) then
      raise exception 'Resolutions: circulate the resolution as it was drafted.';
    end if;
    new.circulated_on := coalesce(new.circulated_on, current_date);
    if new.circulated_on > current_date then
      raise exception 'Resolutions: the date it was circulated can''t be in the future.';
    end if;
    if not exists (select 1 from public.decisions d where d.resolution_id = old.id and d.outcome = 'proposed') then
      raise exception 'Resolutions: add at least one decision before circulating.';
    end if;
    -- Everyone entitled to vote on that day must be asked to sign, and nobody else.
    select count(*) into missing from (
      select v.person_id, v.organisation_id, v.holder_entity_id from private.voters(old.body, old.entity_id, old.governance_body_id, new.circulated_on) v
      except
      select s.person_id, s.organisation_id, s.holder_entity_id from public.resolution_signatories s where s.resolution_id = old.id
    ) x;
    if missing > 0 then
      raise exception 'Resolutions: % entitled to vote on % % not listed to sign. Add everyone entitled to vote.',
        missing, to_char(new.circulated_on, 'DD/MM/YYYY'), case when missing = 1 then 'is' else 'are' end;
    end if;
    if exists (
      select 1 from public.resolution_signatories s where s.resolution_id = old.id
        and not private.is_voter(old.body, old.entity_id, old.governance_body_id, s.person_id, s.organisation_id, s.holder_entity_id, new.circulated_on)
    ) then
      raise exception 'Resolutions: someone listed to sign wasn''t entitled to vote on %.', to_char(new.circulated_on, 'DD/MM/YYYY');
    end if;
    -- Each signatory's votes: one each, or their voting shares for members.
    perform set_config('vs.passing', 'on', true);
    update public.resolution_signatories s
      set votes = coalesce((select v.votes from private.voters(old.body, old.entity_id, old.governance_body_id, new.circulated_on) v
                            where v.person_id is not distinct from s.person_id and v.organisation_id is not distinct from s.organisation_id
                              and v.holder_entity_id is not distinct from s.holder_entity_id limit 1), 1),
          signed_on = null
      where s.resolution_id = old.id;
    perform set_config('vs.passing', 'off', true);
    if not (auth.uid() = any (old.edited_by)) then
      new.edited_by := old.edited_by || auth.uid();
    end if;
    return new;
  end if;

  if old.status = 'circulated' and new.status = 'draft' then
    if exists (select 1 from public.resolution_signatories s where s.resolution_id = old.id and s.signed_on is not null) then
      raise exception 'Resolutions: signatures have been recorded, so it can''t go back to a draft. Mark it as lapsed and start a new one.';
    end if;
    new.circulated_on := null;
    new.prepared_by := auth.uid();
    if not (auth.uid() = any (old.edited_by)) then
      new.edited_by := old.edited_by || auth.uid();
    end if;
    return new;
  end if;

  if old.status = 'circulated' and new.status = 'lapsed' then
    if (to_jsonb(new) - array['status', 'updated_at']) is distinct from (to_jsonb(old) - array['status', 'updated_at']) then
      raise exception 'Resolutions: mark it as lapsed without other changes.';
    end if;
    return new;
  end if;

  if old.status = 'circulated' and new.status = 'passed' then
    if not private.can_manage() then
      raise exception 'Resolutions: only a Manager can confirm that a resolution has passed.';
    end if;
    if auth.uid() is not distinct from old.prepared_by or auth.uid() = any (old.edited_by) then
      raise exception 'Resolutions: whoever prepared a resolution or recorded its signatures can''t also confirm it. Ask another Manager.';
    end if;
    if (to_jsonb(new) - array['status', 'updated_at']) is distinct from (to_jsonb(old) - array['status', 'updated_at']) then
      raise exception 'Resolutions: confirm the resolution as it was circulated.';
    end if;
    passes := private.resolution_passes_on(old.id);
    if passes is null then
      raise exception 'Resolutions: not enough signatures have been recorded for it to pass (%).',
        case old.required when 'all' then 'everyone must sign' when 'majority' then 'more than half the votes are needed' else 'three quarters of the votes are needed' end;
    end if;
    new.passed_on := passes;
    new.number := private.next_number('written_resolutions', old.body, old.entity_id, old.governance_body_id);
    new.confirmed_by := auth.uid();
    new.confirmed_at := now();
    perform set_config('vs.passing', 'on', true);
    update public.decisions set outcome = 'carried', passed_on = passes where resolution_id = old.id and outcome = 'proposed';
    perform set_config('vs.passing', 'off', true);
    return new;
  end if;

  if old.status = 'circulated' and new.status = 'circulated' then
    if (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
      raise exception 'Resolutions: a circulated resolution can''t be changed. Only signatures are recorded.';
    end if;
    -- Whoever records a signature can't confirm that it passed.
    if not (auth.uid() = any (old.edited_by)) then
      new.edited_by := old.edited_by || auth.uid();
    end if;
    return new;
  end if;

  raise exception 'Resolutions: that change isn''t possible (from % to %).', old.status, new.status;
end;
$$;

create trigger written_resolutions_rules before insert or update on public.written_resolutions
  for each row execute function private.resolution_rules();

create function private.signatory_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.written_resolutions;
  r record := coalesce(new, old);
begin
  if current_setting('vs.passing', true) = 'on' or auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select * into w from public.written_resolutions where id = r.resolution_id;
  if tg_op = 'UPDATE' and new.resolution_id <> old.resolution_id then
    raise exception 'Resolutions: a signatory can''t be moved to another resolution.';
  end if;
  if w.status = 'draft' then
    if tg_op <> 'DELETE' then
      if new.signed_on is not null then
        raise exception 'Resolutions: signatures are recorded once the resolution has been circulated.';
      end if;
      if not private.is_voter(w.body, w.entity_id, w.governance_body_id, new.person_id, new.organisation_id, new.holder_entity_id, current_date) then
        raise exception 'Resolutions: only someone entitled to vote can be asked to sign.';
      end if;
    end if;
  elsif w.status = 'circulated' then
    if tg_op <> 'UPDATE'
       or (to_jsonb(new) - array['signed_on', 'signed_for_by']) is distinct from (to_jsonb(old) - array['signed_on', 'signed_for_by']) then
      raise exception 'Resolutions: once circulated, only the date each person signed is recorded.';
    end if;
    if new.signed_on is not null and (new.signed_on < w.circulated_on or new.signed_on > current_date) then
      raise exception 'Resolutions: a signature is dated between the day it was circulated (%) and today.', to_char(w.circulated_on, 'DD/MM/YYYY');
    end if;
  else
    raise exception 'Resolutions: the signatures of a resolution that has passed or lapsed can''t change.';
  end if;
  perform private.touch_parent(null, r.resolution_id);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger resolution_signatories_rules before insert or update or delete on public.resolution_signatories
  for each row execute function private.signatory_rules();

create function private.file_note_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.written_by := coalesce(auth.uid(), new.written_by);
  else
    new.written_by := old.written_by;
  end if;
  return new;
end;
$$;

create trigger file_notes_rules before insert or update on public.file_notes
  for each row execute function private.file_note_rules();

-- ---------------------------------------------------------------------------
-- 8. Share transactions and appointments need a passed decision
--
-- basis: 'decision' (a passed minute or written resolution of the entity's
-- board or members), 'formation' (the entity's constitution, deed or charter
-- when it was formed), 'instrument' (a deed or letter of appointment, e.g. by
-- a protector; its reference is required), or 'earlier' (recorded before
-- decisions were kept here).

alter table public.share_transactions
  add column decision_id uuid references public.decisions (id) on delete set null,
  add column basis text check (basis in ('decision', 'formation', 'instrument', 'earlier')),
  add column basis_note text;
alter table public.appointments
  add column decision_id uuid references public.decisions (id) on delete set null,
  add column basis text check (basis in ('decision', 'formation', 'instrument', 'earlier')),
  add column basis_note text;

-- Approved transactions are otherwise locked, so their lock is lifted for
-- this one change only.
alter table public.share_transactions disable trigger share_transactions_rules;
update public.share_transactions set basis = 'earlier' where status = 'approved';
alter table public.share_transactions enable trigger share_transactions_rules;
update public.appointments set basis = 'earlier';

-- The entity a decision was made for (its board's or members'), or null.
create function private.decision_entity(p_decision uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(m.entity_id, w.entity_id)
  from public.decisions d
  left join public.meetings m on m.id = d.meeting_id
  left join public.written_resolutions w on w.id = d.resolution_id
  where d.id = p_decision;
$$;

create function private.check_basis(p_entity uuid, p_basis text, p_decision uuid, p_note text, p_on date, p_what text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  passed date;
begin
  if p_basis is null then
    raise exception '%: say what it was decided by (a passed minute or resolution, the formation documents, or a deed of appointment).', p_what;
  end if;
  if p_basis = 'decision' then
    passed := (select d.passed_on from public.decisions d where d.id = p_decision);
    if passed is null then
      raise exception '%: the decision it relies on hasn''t passed yet. Its meeting must be confirmed, or its resolution passed, first.', p_what;
    end if;
    if p_on is not null and passed > p_on then
      raise exception '%: the decision passed on %, after the date of %. Check the dates.', p_what, to_char(passed, 'DD/MM/YYYY'), to_char(p_on, 'DD/MM/YYYY');
    end if;
  end if;
  -- The formation documents only cover what was done when it was formed.
  if p_basis = 'formation' and p_on is not null
     and exists (select 1 from public.entities e where e.id = p_entity and e.registered_on is not null and p_on > e.registered_on + 30) then
    raise exception '%: the formation documents only cover what was done when it was formed (within 30 days of registration). Choose the minute or resolution.', p_what;
  end if;
  if p_basis = 'instrument' and length(trim(coalesce(p_note, ''))) = 0 then
    raise exception '%: give the deed or letter of appointment (its date and who signed it).', p_what;
  end if;
end;
$$;

create function private.basis_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  what text := case tg_table_name when 'share_transactions' then 'Shares' else 'Appointments' end;
begin
  if auth.uid() is null then
    if tg_op = 'INSERT' and new.basis is null and (tg_table_name = 'appointments' or to_jsonb(new)->>'status' = 'approved') then
      new.basis := 'earlier';
    end if;
    return new;
  end if;
  if not private.can_edit() then
    return new; -- refused by the access rules
  end if;
  if new.basis = 'earlier' and (tg_op = 'INSERT' or old.basis is distinct from 'earlier') then
    raise exception '%: only records made before decisions were kept here are marked "earlier".', what;
  end if;
  if new.decision_id is not null and new.basis is distinct from 'decision' then
    new.decision_id := null;
  end if;
  if new.basis = 'decision' and new.decision_id is null then
    raise exception '%: choose the decision it relies on.', what;
  end if;
  if new.decision_id is not null and private.decision_entity(new.decision_id) is distinct from new.entity_id then
    raise exception '%: the decision must be one of this entity''s (its board''s or members'').', what;
  end if;
  if new.basis is distinct from 'instrument' then
    new.basis_note := null;
  end if;
  if tg_table_name = 'share_transactions' and new.basis = 'instrument' then
    raise exception 'Shares: a share transaction is decided by a minute or resolution, or the formation documents.';
  end if;
  if tg_table_name = 'appointments' and tg_op = 'UPDATE'
     and (to_jsonb(new) -> 'entity_id', to_jsonb(new) -> 'role', to_jsonb(new) -> 'person_id', to_jsonb(new) -> 'organisation_id', to_jsonb(new) -> 'holder_entity_id')
         is distinct from (to_jsonb(old) -> 'entity_id', to_jsonb(old) -> 'role', to_jsonb(old) -> 'person_id', to_jsonb(old) -> 'organisation_id', to_jsonb(old) -> 'holder_entity_id') then
    raise exception 'Appointments: who holds a role, and which role, can''t be changed. End the appointment and record the new one, with the decision behind it.';
  end if;

  if tg_table_name = 'share_transactions' then
    -- Checked when it is approved: that is when it goes on the register.
    if tg_op = 'UPDATE' and old.status = 'draft' and new.status = 'approved' then
      perform private.check_basis(new.entity_id, new.basis, new.decision_id, new.basis_note, new.transaction_date, what);
    end if;
  elsif tg_op = 'INSERT'
     or new.basis is distinct from old.basis or new.decision_id is distinct from old.decision_id
     or new.basis_note is distinct from old.basis_note or new.appointed_on is distinct from old.appointed_on then
    if new.basis is distinct from 'earlier' then
      perform private.check_basis(new.entity_id, new.basis, new.decision_id, new.basis_note, new.appointed_on, what);
    end if;
  end if;
  return new;
end;
$$;

-- Runs after the share transaction rules (triggers run in name order), so
-- their checks (e.g. who may approve) come first.
create trigger share_transactions_rules_basis before insert or update on public.share_transactions
  for each row execute function private.basis_rules();
create trigger appointments_rules_basis before insert or update on public.appointments
  for each row execute function private.basis_rules();

-- ---------------------------------------------------------------------------
-- 9. Row-level security

alter table public.meetings enable row level security;
alter table public.meeting_attendees enable row level security;
alter table public.written_resolutions enable row level security;
alter table public.resolution_signatories enable row level security;
alter table public.decisions enable row level security;
alter table public.file_notes enable row level security;
alter table public.file_note_people enable row level security;

create function private.can_see_meeting(p_meeting uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.meetings m where m.id = p_meeting and private.can_see_body(m.body, m.entity_id, m.governance_body_id));
$$;
create function private.can_see_resolution(p_resolution uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.written_resolutions w where w.id = p_resolution and private.can_see_body(w.body, w.entity_id, w.governance_body_id));
$$;
create function private.can_see_note(p_note uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.file_notes n where n.id = p_note and case
      when n.entity_id is not null then private.can_see_entity_id(n.entity_id)
      when n.governance_body_id is not null then private.can_see_body('governance', null, n.governance_body_id)
      when n.branch_id is not null then private.can_see_scope(n.branch_id)
      else private.can_edit() or private.has_grant('whole_family')
    end
  );
$$;

create policy "meetings: read" on public.meetings
  for select to authenticated using (private.can_see_body(body, entity_id, governance_body_id));
create policy "written_resolutions: read" on public.written_resolutions
  for select to authenticated using (private.can_see_body(body, entity_id, governance_body_id));
-- People a Viewer can't see in the Tree aren't shown to them.
create policy "meeting_attendees: read" on public.meeting_attendees
  for select to authenticated using (private.can_see_meeting(meeting_id) and (person_id is null or private.can_see_person_id(person_id)));
create policy "resolution_signatories: read" on public.resolution_signatories
  for select to authenticated using (private.can_see_resolution(resolution_id) and (person_id is null or private.can_see_person_id(person_id)));
create policy "decisions: read" on public.decisions
  for select to authenticated using (
    case when meeting_id is not null then private.can_see_meeting(meeting_id) else private.can_see_resolution(resolution_id) end
  );
-- Uses the note's own columns (not a look-up), so a new note can be read back.
create policy "file_notes: read" on public.file_notes
  for select to authenticated using (
    case
      when entity_id is not null then private.can_see_entity_id(entity_id)
      when governance_body_id is not null then private.can_see_body('governance', null, governance_body_id)
      when branch_id is not null then private.can_see_scope(branch_id)
      -- About the whole family: editors and Viewers with whole-family access.
      else private.can_edit() or private.has_grant('whole_family')
    end
  );
create policy "file_note_people: read" on public.file_note_people
  for select to authenticated using (private.can_see_note(note_id) and private.can_see_person_id(person_id));

do $$
declare
  t text;
begin
  foreach t in array array['meetings', 'meeting_attendees', 'written_resolutions', 'resolution_signatories', 'decisions', 'file_notes', 'file_note_people'] loop
    execute format('create policy "%1$s: editors add" on public.%1$I for insert to authenticated with check (private.can_edit())', t);
    execute format('create policy "%1$s: editors change" on public.%1$I for update to authenticated using (private.can_edit()) with check (private.can_edit())', t);
    -- No delete rule: a record is removed only by two people (removal requests).
    execute format('create trigger %1$s_log after insert or update or delete on public.%1$I for each row execute function private.log_change()', t);
    execute format('revoke all on public.%1$I from anon', t);
  end loop;
end;
$$;

create trigger meetings_updated_at before update on public.meetings
  for each row execute function private.touch_updated_at();
create trigger written_resolutions_updated_at before update on public.written_resolutions
  for each row execute function private.touch_updated_at();
create trigger decisions_updated_at before update on public.decisions
  for each row execute function private.touch_updated_at();
create trigger file_notes_updated_at before update on public.file_notes
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 10. Removals (two people), and what is kept for good

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
    ('file_note_people', 'Person linked to a file note', 'id')
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

revoke all on function private.board_roles(), private.votes_held(uuid, uuid, uuid, uuid, date),
  private.voters(text, uuid, uuid, date), private.is_voter(text, uuid, uuid, uuid, uuid, uuid, date),
  private.next_number(text, text, uuid, uuid), private.check_body(text, uuid), private.meeting_rules(),
  private.touch_parent(uuid, uuid), private.attendee_rules(), private.decision_rules(), private.resolution_rules(),
  private.signatory_rules(), private.file_note_rules(), private.decision_entity(uuid),
  private.check_basis(uuid, text, uuid, text, date, text), private.basis_rules() from public;
revoke all on function private.meeting_quorum(uuid), private.resolution_passes_on(uuid) from public;
revoke all on function private.can_see_body(text, uuid, uuid), private.can_see_meeting(uuid),
  private.can_see_resolution(uuid), private.can_see_note(uuid) from public;
grant execute on function private.can_see_body(text, uuid, uuid), private.can_see_meeting(uuid),
  private.can_see_resolution(uuid), private.can_see_note(uuid) to authenticated;

-- The app reads the quorum and the voters through these.
create function public.meeting_quorum(p_meeting uuid)
returns table (entitled integer, present integer, needed integer)
language sql
stable
security definer
set search_path = ''
as $$
  select q.* from private.meeting_quorum(p_meeting) q where private.can_see_meeting(p_meeting);
$$;
create function public.body_voters(p_body text, p_entity uuid, p_gov uuid, p_on date)
returns table (person_id uuid, organisation_id uuid, holder_entity_id uuid, votes bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select v.* from private.voters(p_body, p_entity, p_gov, p_on) v
  where private.can_see_body(p_body, p_entity, p_gov) and private.can_edit();
$$;
revoke all on function public.meeting_quorum(uuid), public.body_voters(text, uuid, uuid, date) from public, anon;
grant execute on function public.meeting_quorum(uuid), public.body_voters(text, uuid, uuid, date) to authenticated;
