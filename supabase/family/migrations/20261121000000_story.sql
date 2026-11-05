-- The Story: the family story, in chapters, and each person's stories (their
-- Book of Life, decision of 30–31 Oct 2026).
--
-- The owner's choices (5 Nov 2026):
--   - The team (Managers and Administrators) writes and edits stories. A
--     family member (a Viewer) can send in their own story; the team
--     reviews it before it is added. Viewers stay read-only everywhere else:
--     they send a story in through suggest_story(), never by writing to the
--     tables.
--   - Each story's audience is chosen: the whole family, one branch, or only
--     the people it is about (and the team).
--   - The family story has chapters, which can be renamed or added to;
--     stories are tagged by theme and can be linked to a timeline event.
--   - A person's Book of Life shows their stories, their timeline and
--     prompts to help them tell their story.

create table public.story_chapters (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  description text,
  sort integer not null default 100,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.stories (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  body text not null check (length(trim(body)) > 0),
  told_by text, -- who told or wrote it, in words (e.g. "Told by her daughter")
  happened_on date, -- when it happened, as exactly as it is known
  precision text not null default 'year' check (precision in ('day', 'month', 'year')),
  place text,
  prompt text, -- the question it answers, if it came from a prompt
  themes text[] not null default '{}' check (themes <@ array['origins', 'work_and_wealth', 'values_and_faith', 'family_life', 'turning_points', 'giving', 'places', 'traditions', 'lessons', 'hopes']::text[]),
  chapter_id uuid references public.story_chapters (id) on delete set null,
  timeline_event_id uuid references public.timeline_events (id) on delete set null,
  audience text not null default 'family' check (audience in ('family', 'branch', 'people')),
  branch_id uuid references public.branches (id) on delete restrict,
  status text not null default 'published' check (status in ('suggested', 'published', 'declined')),
  submitted_by uuid, -- the family member who sent it in
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((audience = 'branch') = (branch_id is not null)),
  check (happened_on is null or happened_on <= '2200-01-01')
);
create index stories_chapter on public.stories (chapter_id);

create table public.story_people (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories (id) on delete cascade,
  -- Restrict: removing the person would otherwise change who sees the story.
  person_id uuid not null references public.people (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (story_id, person_id)
);
create index story_people_person on public.story_people (person_id);

-- ---------------------------------------------------------------------------
-- Rules

create function private.story_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    -- Only suggest_story() sends a story in for review.
    if new.status <> 'published' and auth.uid() is not null and current_setting('vs.suggesting', true) is distinct from 'on' then
      raise exception 'Story: a family member sends a story in from their Book of Life.';
    end if;
    if current_setting('vs.suggesting', true) is distinct from 'on' then
      new.submitted_by := null;
    end if;
    new.reviewed_by := null;
    new.reviewed_at := null;
  else
    new.created_by := old.created_by;
    new.submitted_by := old.submitted_by;
    -- Who sees a story is decided by its audience: only a Manager changes it.
    if auth.uid() is not null and not private.can_manage()
       and (new.audience is distinct from old.audience or new.branch_id is distinct from old.branch_id) then
      raise exception 'Story: only a Manager can change who may read a story.';
    end if;
    if new.status is distinct from old.status then
      if old.status <> 'suggested' then
        raise exception 'Story: only a story that was sent in can be added or declined.';
      end if;
      new.reviewed_by := auth.uid();
      new.reviewed_at := now();
    else
      new.reviewed_by := old.reviewed_by;
      new.reviewed_at := old.reviewed_at;
    end if;
  end if;
  if new.happened_on > (now() at time zone 'Europe/London')::date then
    raise exception 'Story: a story can''t happen in the future.';
  end if;
  return new;
end;
$$;
create trigger stories_rules before insert or update on public.stories
  for each row execute function private.story_rules();

create function private.story_people_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.story_id <> old.story_id or new.person_id <> old.person_id then
    raise exception 'Story: a link to a person can''t be moved. Add a new link and ask for the old one to be removed.';
  end if;
  return new;
end;
$$;
create trigger story_people_rules before update on public.story_people
  for each row execute function private.story_people_rules();

-- The people a story is about decide who may read it, so linking someone to a
-- story that was already saved is for a Manager (as changing its audience is).
-- add_story() and suggest_story() link people as the story is saved.
create function private.story_people_add_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and not private.can_manage()
     and current_setting('vs.suggesting', true) is distinct from 'on'
     and exists (select 1 from public.stories s where s.id = new.story_id and s.created_at < now()) then
    raise exception 'Story: only a Manager can add people to a story once it is saved, because it changes who may read it.';
  end if;
  return new;
end;
$$;
create trigger story_people_add_rules before insert on public.story_people
  for each row execute function private.story_people_add_rules();

create function private.chapter_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;
create trigger story_chapters_rules before insert or update on public.story_chapters
  for each row execute function private.chapter_rules();

-- ---------------------------------------------------------------------------
-- Who sees what

-- The person linked to the signed-in login, if any.
create function private.my_person_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.people p where p.user_id = auth.uid() and private.my_role() is not null;
$$;

create function private.can_see_story(p_story uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.stories s
    where s.id = p_story and (
      private.can_edit()
      -- A family member sees what they sent in, until it is added (then the
      -- audience decides, as for everyone).
      or (s.submitted_by = auth.uid() and s.status <> 'published' and private.my_role() is not null)
      or (
        private.my_role() = 'viewer' and s.status = 'published'
        and case s.audience
          when 'family' then true
          when 'branch' then private.can_see_scope(s.branch_id)
          else exists (select 1 from public.story_people x where x.story_id = s.id and x.person_id = private.my_person_id())
        end
        -- and only if they may see everyone it is about.
        and not exists (select 1 from public.story_people x where x.story_id = s.id and not private.can_see_person_id(x.person_id))
      )
    )
  );
$$;

alter table public.story_chapters enable row level security;
alter table public.stories enable row level security;
alter table public.story_people enable row level security;

create policy "story_chapters: read" on public.story_chapters
  for select to authenticated using (private.my_role() is not null);
-- Uses the row's own columns for the team, so a new story can be read back.
create policy "stories: read" on public.stories
  for select to authenticated using (private.can_edit() or private.can_see_story(id));
create policy "story_people: read" on public.story_people
  for select to authenticated using (private.can_see_story(story_id) and (private.can_edit() or private.can_see_person_id(person_id)));

do $$
declare
  t text;
begin
  foreach t in array array['story_chapters', 'stories', 'story_people'] loop
    execute format('create policy "%1$s: editors add" on public.%1$I for insert to authenticated with check (private.can_edit())', t);
    execute format('create policy "%1$s: editors change" on public.%1$I for update to authenticated using (private.can_edit()) with check (private.can_edit())', t);
    -- No delete rule: a record is removed only by two people (removal requests).
    execute format('create trigger %1$s_log after insert or update or delete on public.%1$I for each row execute function private.log_change()', t);
    execute format('revoke all on public.%1$I from anon', t);
  end loop;
end;
$$;
create trigger story_chapters_updated_at before update on public.story_chapters
  for each row execute function private.touch_updated_at();
create trigger stories_updated_at before update on public.stories
  for each row execute function private.touch_updated_at();

-- A story and the people it is about are saved together (team only; the
-- caller's own rights apply).
create function public.add_story(p_story jsonb, p_people uuid[])
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.stories (title, body, told_by, happened_on, precision, place, prompt, themes, chapter_id, timeline_event_id, audience, branch_id)
  values (
    p_story ->> 'title', p_story ->> 'body', p_story ->> 'told_by', (p_story ->> 'happened_on')::date,
    coalesce(p_story ->> 'precision', 'year'), p_story ->> 'place', p_story ->> 'prompt',
    coalesce((select array_agg(x) from jsonb_array_elements_text(p_story -> 'themes') x), '{}'),
    (p_story ->> 'chapter_id')::uuid, (p_story ->> 'timeline_event_id')::uuid,
    coalesce(p_story ->> 'audience', 'family'), (p_story ->> 'branch_id')::uuid
  )
  returning id into v_id;
  insert into public.story_people (story_id, person_id)
  select v_id, p from unnest(coalesce(p_people, '{}')) as p group by p;
  return v_id;
end;
$$;

-- A family member sends in a story about themselves. It waits for the team
-- to review it, and only they (and the team) see it until then.
create function public.suggest_story(p_title text, p_body text, p_happened_on date, p_precision text, p_place text, p_prompt text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.my_person_id();
  v_id uuid;
begin
  if me is null or not private.can_see_person_id(me) then
    raise exception 'Story: your login isn''t linked to your record in the Tree, so a story can''t be sent in yet. A Manager links logins to people.';
  end if;
  if length(trim(coalesce(p_title, ''))) = 0 or length(trim(coalesce(p_body, ''))) = 0 then
    raise exception 'Story: please give the story a title and tell it.';
  end if;
  if coalesce(p_precision, 'year') not in ('day', 'month', 'year') then
    raise exception 'Story: please say how exact the date is.';
  end if;
  if length(p_body) > 20000 or length(p_title) > 200 or length(coalesce(p_place, '')) > 200 or length(coalesce(p_prompt, '')) > 500 then
    raise exception 'Story: that story is too long to send in this way. Please send a shorter version, and the team can add the rest.';
  end if;
  perform set_config('vs.suggesting', 'on', true);
  insert into public.stories (title, body, happened_on, precision, place, prompt, audience, status, submitted_by, told_by)
  values (trim(p_title), p_body, p_happened_on, coalesce(p_precision, 'year'), nullif(trim(coalesce(p_place, '')), ''), nullif(trim(coalesce(p_prompt, '')), ''),
    'people', 'suggested', auth.uid(), 'Sent in by them')
  returning id into v_id;
  insert into public.story_people (story_id, person_id) values (v_id, me);
  perform set_config('vs.suggesting', 'off', true);
  return v_id;
end;
$$;

revoke all on function private.story_rules(), private.story_people_rules(), private.story_people_add_rules(), private.chapter_rules() from public;
revoke all on function private.my_person_id(), private.can_see_story(uuid) from public;
grant execute on function private.my_person_id(), private.can_see_story(uuid) to authenticated;
revoke all on function public.add_story(jsonb, uuid[]), public.suggest_story(text, text, date, text, text, text) from public, anon;
grant execute on function public.add_story(jsonb, uuid[]), public.suggest_story(text, text, date, text, text, text) to authenticated;

-- The starting chapters of the family story (they can be renamed, reordered
-- or added to).
insert into public.story_chapters (title, description, sort) values
  ('Origins', 'Where the family comes from: places, people and the times they lived in.', 10),
  ('How the wealth was made', 'The work, the risks and the luck behind what the family has.', 20),
  ('Values and faith', 'What the family believes in, and how that shows in what it does.', 30),
  ('Turning points', 'The moments that changed the family''s path.', 40),
  ('Hopes for the future', 'What each generation hopes for those who come after.', 50);

-- Stories and chapters can be removed (by two people) like everything else.
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
    ('timeline_event_people', 'Person linked to a timeline event', 'id'),
    ('story_chapters', 'Chapter of the family story', 'id'),
    ('stories', 'Story', 'id'),
    ('story_people', 'Person linked to a story', 'id')
  ) as v (table_name, label, key_column)
  where v.table_name = p_table;
$$;
revoke all on function private.removable(text) from public;
