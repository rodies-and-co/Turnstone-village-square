-- Risk management: the family's one risk register (decision 1.2). Each risk
-- is about the whole family, a branch, an entity or a person, is filed under
-- one of the hub's risk categories, and is rated on a 5 x 5 scale before
-- controls (inherent) and after them (residual). A rating is a draft until a
-- Manager who didn't prepare it approves it (the preparer is not the
-- approver); the heat map uses approved ratings. Suggested risks worked out
-- from the records are accepted into the register or dismissed with a
-- reason, never added by themselves.

create table public.risks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  description text,
  -- The key of a hub risk category (the hub holds no family records, so it
  -- can't be a foreign key; the app checks it).
  category text not null check (category ~ '^[a-z][a-z0-9_]{1,40}$'),
  subcategory text,
  entity_id uuid references public.entities (id) on delete restrict,
  branch_id uuid references public.branches (id) on delete restrict,
  person_id uuid references public.people (id) on delete restrict,
  -- How the risk is handled: treat (reduce it), tolerate (accept it),
  -- transfer (e.g. insure it) or terminate (stop the activity).
  response text not null default 'treat' check (response in ('treat', 'tolerate', 'transfer', 'terminate')),
  owner_id uuid, -- someone with a login: a Manager or Administrator of the family
  next_review_on date,
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_on date,
  closed_reason text,
  closed_by uuid,
  suggestion_key text unique, -- set when it came from a suggestion
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(entity_id, branch_id, person_id) <= 1),
  check (status = 'open' or (closed_on is not null and length(trim(coalesce(closed_reason, ''))) > 0))
);
create index risks_entity on public.risks (entity_id);
create index risks_person on public.risks (person_id);

create table public.risk_reviews (
  id uuid primary key default gen_random_uuid(),
  risk_id uuid not null references public.risks (id) on delete cascade,
  reviewed_on date not null default (now() at time zone 'Europe/London')::date,
  inherent_likelihood smallint not null check (inherent_likelihood between 1 and 5),
  inherent_impact smallint not null check (inherent_impact between 1 and 5),
  residual_likelihood smallint not null check (residual_likelihood between 1 and 5),
  residual_impact smallint not null check (residual_impact between 1 and 5),
  controls text,
  notes text,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  prepared_by uuid,
  -- Everyone who changed the draft after it was prepared. None of them, nor
  -- the preparer, may approve it.
  changed_by uuid[] not null default '{}',
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Controls can lower a risk but never raise it.
  check (residual_likelihood * residual_impact <= inherent_likelihood * inherent_impact)
);
-- One draft rating at a time per risk.
create unique index risk_reviews_one_draft on public.risk_reviews (risk_id) where status = 'draft';

create table public.risk_suggestion_answers (
  id uuid primary key default gen_random_uuid(),
  suggestion_key text not null unique,
  dismissed boolean not null default true,
  reason text,
  answered_by uuid,
  answered_at timestamptz not null default now(),
  check (not dismissed or length(trim(coalesce(reason, ''))) > 0)
);

-- ---------------------------------------------------------------------------
-- Rules

create function private.risk_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    if new.status <> 'open' then
      raise exception 'Risks: a new risk starts open.';
    end if;
    new.closed_on := null;
    new.closed_reason := null;
    new.closed_by := null;
    return new;
  end if;
  new.created_by := old.created_by;
  if new.suggestion_key is distinct from old.suggestion_key then
    raise exception 'Risks: where a risk came from can''t change.';
  end if;
  if auth.uid() is not null and not private.can_manage() then
    -- What a risk is about decides who sees it; closing takes it off the heat map.
    if new.entity_id is distinct from old.entity_id or new.branch_id is distinct from old.branch_id or new.person_id is distinct from old.person_id then
      raise exception 'Risks: only a Manager can change what a risk is about.';
    end if;
    if new.status is distinct from old.status then
      raise exception 'Risks: only a Manager can close or reopen a risk.';
    end if;
  end if;
  if new.status = 'closed' and old.status = 'closed'
     and (new.closed_on is distinct from old.closed_on or new.closed_reason is distinct from old.closed_reason) then
    raise exception 'Risks: when and why a risk was closed can''t change. A Manager reopens it and closes it again.';
  end if;
  if new.status = 'closed' and old.status = 'open' then
    new.closed_by := auth.uid();
    if new.closed_on > (now() at time zone 'Europe/London')::date then
      raise exception 'Risks: a risk can''t be closed on a future date.';
    end if;
  elsif new.status = 'open' then
    new.closed_on := null;
    new.closed_reason := null;
    new.closed_by := null;
  else
    new.closed_by := old.closed_by;
  end if;
  return new;
end;
$$;
create trigger risks_rules before insert or update on public.risks
  for each row execute function private.risk_rules();

create function private.risk_review_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  content_changed boolean;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' and auth.uid() is not null then
      raise exception 'Risks: a new rating starts as a draft. A Manager who didn''t prepare it approves it.';
    end if;
    new.prepared_by := coalesce(auth.uid(), new.prepared_by);
    new.changed_by := '{}';
    if new.status = 'draft' then
      new.approved_by := null;
      new.approved_at := null;
    end if;
    if new.reviewed_on > (now() at time zone 'Europe/London')::date then
      raise exception 'Risks: a rating can''t be dated in the future.';
    end if;
    return new;
  end if;

  if old.status = 'approved' then
    raise exception 'Risks: an approved rating can''t be changed. Rate the risk again instead.';
  end if;
  if new.risk_id <> old.risk_id then
    raise exception 'Risks: a rating can''t be moved to another risk.';
  end if;
  new.prepared_by := old.prepared_by;
  new.changed_by := old.changed_by;
  new.approved_by := old.approved_by;
  new.approved_at := old.approved_at;
  content_changed := (new.inherent_likelihood, new.inherent_impact, new.residual_likelihood, new.residual_impact, new.controls, new.notes, new.reviewed_on)
    is distinct from (old.inherent_likelihood, old.inherent_impact, old.residual_likelihood, old.residual_impact, old.controls, old.notes, old.reviewed_on);

  if new.status = 'approved' then
    if content_changed then
      raise exception 'Risks: a rating can''t be changed and approved in one step.';
    end if;
    if auth.uid() is not null then
      if not private.can_manage() then
        raise exception 'Risks: only a Manager can approve a rating.';
      end if;
      if auth.uid() is not distinct from old.prepared_by or auth.uid() = any (old.changed_by) then
        raise exception 'Risks: whoever prepared or changed a rating can''t also approve it. Ask another Manager.';
      end if;
    end if;
    new.approved_by := auth.uid();
    new.approved_at := now();
  elsif content_changed then
    if auth.uid() is not null and auth.uid() is distinct from old.prepared_by and not auth.uid() = any (old.changed_by) then
      new.changed_by := old.changed_by || auth.uid();
    end if;
    if new.reviewed_on > (now() at time zone 'Europe/London')::date then
      raise exception 'Risks: a rating can''t be dated in the future.';
    end if;
  end if;
  return new;
end;
$$;
create trigger risk_reviews_rules before insert or update on public.risk_reviews
  for each row execute function private.risk_review_rules();

-- An approved rating is reviewed again a year after it was made,
create function private.risk_review_next()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'approved' and old.status = 'draft' then
    update public.risks r set next_review_on = (new.reviewed_on + interval '1 year')::date
    -- unless a later date has been set on purpose (one more than 60 days away).
    where r.id = new.risk_id and (r.next_review_on is null or r.next_review_on <= (now() at time zone 'Europe/London')::date + 60);
  end if;
  return new;
end;
$$;
create trigger risk_reviews_next after update on public.risk_reviews
  for each row execute function private.risk_review_next();

create function private.risk_answer_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.suggestion_key <> old.suggestion_key then
    raise exception 'Risks: a suggestion''s answer can''t be moved to another suggestion.';
  end if;
  -- Asking again after a dismissal is for a Manager.
  if tg_op = 'UPDATE' and old.dismissed and not new.dismissed and auth.uid() is not null and not private.can_manage() then
    raise exception 'Risks: only a Manager can ask a dismissed suggestion again.';
  end if;
  new.answered_by := coalesce(auth.uid(), new.answered_by);
  new.answered_at := now();
  return new;
end;
$$;
create trigger risk_suggestion_answers_rules before insert or update on public.risk_suggestion_answers
  for each row execute function private.risk_answer_rules();

-- ---------------------------------------------------------------------------
-- Who sees what

create function private.can_see_risk(p_entity uuid, p_branch uuid, p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_entity is not null then private.can_see_entity_id(p_entity)
    when p_branch is not null then private.can_see_scope(p_branch)
    -- Risks about a person are for the family's team (Managers and
    -- Administrators) only, not for Viewers, the person included.
    when p_person is not null then private.can_edit()
    -- About the whole family: editors and Viewers with whole-family access.
    else private.can_edit() or (private.my_role() = 'viewer' and private.has_grant('whole_family'))
  end;
$$;
revoke all on function private.can_see_risk(uuid, uuid, uuid) from public;
grant execute on function private.can_see_risk(uuid, uuid, uuid) to authenticated;
revoke all on function private.risk_rules(), private.risk_review_rules(), private.risk_review_next(), private.risk_answer_rules() from public;

alter table public.risks enable row level security;
alter table public.risk_reviews enable row level security;
alter table public.risk_suggestion_answers enable row level security;

create policy "risks: read" on public.risks
  for select to authenticated using (private.can_see_risk(entity_id, branch_id, person_id));
create policy "risk_reviews: read" on public.risk_reviews
  for select to authenticated using (exists (select 1 from public.risks r where r.id = risk_id));
create policy "risk_suggestion_answers: editors read" on public.risk_suggestion_answers
  for select to authenticated using (private.can_edit());

do $$
declare
  t text;
begin
  foreach t in array array['risks', 'risk_reviews', 'risk_suggestion_answers'] loop
    execute format('create policy "%1$s: editors add" on public.%1$I for insert to authenticated with check (private.can_edit())', t);
    execute format('create policy "%1$s: editors change" on public.%1$I for update to authenticated using (private.can_edit()) with check (private.can_edit())', t);
    -- No delete rule: a record is removed only by two people (removal requests).
    execute format('create trigger %1$s_log after insert or update or delete on public.%1$I for each row execute function private.log_change()', t);
    execute format('revoke all on public.%1$I from anon', t);
  end loop;
end;
$$;
create trigger risks_updated_at before update on public.risks
  for each row execute function private.touch_updated_at();
create trigger risk_reviews_updated_at before update on public.risk_reviews
  for each row execute function private.touch_updated_at();

-- A risk and its first (draft) rating are saved together. Runs with the
-- caller's own rights, so every rule above applies.
create function public.add_risk(p_risk jsonb, p_rating jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.risks (title, description, category, subcategory, entity_id, branch_id, person_id, response, owner_id, next_review_on, suggestion_key)
  values (
    p_risk ->> 'title', p_risk ->> 'description', p_risk ->> 'category', p_risk ->> 'subcategory',
    (p_risk ->> 'entity_id')::uuid, (p_risk ->> 'branch_id')::uuid, (p_risk ->> 'person_id')::uuid,
    coalesce(p_risk ->> 'response', 'treat'), (p_risk ->> 'owner_id')::uuid, (p_risk ->> 'next_review_on')::date,
    p_risk ->> 'suggestion_key'
  )
  returning id into v_id;
  if p_rating is not null then
    insert into public.risk_reviews (risk_id, reviewed_on, inherent_likelihood, inherent_impact, residual_likelihood, residual_impact, controls, notes)
    values (
      v_id, coalesce((p_rating ->> 'reviewed_on')::date, (now() at time zone 'Europe/London')::date),
      (p_rating ->> 'inherent_likelihood')::smallint, (p_rating ->> 'inherent_impact')::smallint,
      (p_rating ->> 'residual_likelihood')::smallint, (p_rating ->> 'residual_impact')::smallint,
      p_rating ->> 'controls', p_rating ->> 'notes'
    );
  end if;
  return v_id;
end;
$$;
revoke all on function public.add_risk(jsonb, jsonb) from public, anon;
grant execute on function public.add_risk(jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Two-person removal: risks and draft ratings can be asked for; a rated risk
-- is closed instead.

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
    ('risk_reviews', 'Draft risk rating', 'id')
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

-- ---------------------------------------------------------------------------
-- Fix (found in review): file notes about the whole family were shown to
-- anyone with a whole-family grant, even without a current Viewer role (for
-- example, signed in without their second factor, or with access taken
-- away in the hub). Now, as everywhere else, only a current Viewer's grant
-- counts.

create or replace function private.can_see_note(p_note uuid)
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
      else private.can_edit() or (private.my_role() = 'viewer' and private.has_grant('whole_family'))
    end
  );
$$;
drop policy "file_notes: read" on public.file_notes;
create policy "file_notes: read" on public.file_notes
  for select to authenticated using (
    case
      when entity_id is not null then private.can_see_entity_id(entity_id)
      when governance_body_id is not null then private.can_see_body('governance', null, governance_body_id)
      when branch_id is not null then private.can_see_scope(branch_id)
      -- About the whole family: editors and Viewers with whole-family access.
      else private.can_edit() or (private.my_role() = 'viewer' and private.has_grant('whole_family'))
    end
  );
