-- Turnstone Village Square: changes that follow a decision (family database)
--
-- The owner's choice (2 Nov 2026): when someone records an officer change or
-- a share transaction, the decision is drafted for them (in a meeting or a
-- written resolution), and the change follows by itself once the decision
-- passes. A resignation isn't a decision but a note: "The board noted the
-- resignation of [Name] as Director on [date]".
--
-- A decision may carry an action:
--   - 'appoint': the appointment in `proposed` is recorded when it passes;
--   - 'end_appointment': the appointment ends when it passes (a removal);
--   - 'note_resignation': the appointment has already ended; the item notes it;
--   - 'share_transaction': the draft share transactions linked to it are
--     approved onto the register when it passes.
-- The change is made as the Manager who confirms the meeting or the
-- resolution, so it still takes two people, and every normal check runs.
-- In a meeting, an item can be "noted" rather than decided.

alter table public.decisions
  add column action text check (action in ('appoint', 'end_appointment', 'note_resignation', 'share_transaction')),
  add column appointment_id uuid references public.appointments (id) on delete set null,
  add column proposed jsonb;

alter table public.decisions drop constraint decisions_outcome_check;
alter table public.decisions
  add constraint decisions_outcome_check check (outcome in ('proposed', 'carried', 'not_carried', 'withdrawn', 'noted')),
  add constraint decisions_noted_in_meetings check (outcome <> 'noted' or meeting_id is not null);

-- What a decision with an action may say.
create function private.decision_action_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ent uuid;
  body text;
  a public.appointments;
  p jsonb := new.proposed;
begin
  if auth.uid() is null or current_setting('vs.passing', true) = 'on' then
    return new;
  end if;
  if new.action is null then
    if new.appointment_id is not null or new.proposed is not null then
      raise exception 'Decisions: only a decision that changes something carries its details.';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and (new.action, new.appointment_id, new.proposed) is distinct from (old.action, old.appointment_id, old.proposed) then
    raise exception 'Decisions: what a decision will change can''t be altered. Withdraw it and record the change again.';
  end if;
  select coalesce(m.entity_id, w.entity_id), coalesce(m.body, w.body) into ent, body
  from (select 1) x
  left join public.meetings m on m.id = new.meeting_id
  left join public.written_resolutions w on w.id = new.resolution_id;
  if ent is null or body = 'governance' then
    raise exception 'Decisions: changes to officers and shares are decided by the entity''s board or members.';
  end if;

  if new.action = 'appoint' then
    if new.appointment_id is not null or p is null or not (p ? 'role')
       or num_nonnulls(nullif(p->>'person_id', ''), nullif(p->>'organisation_id', ''), nullif(p->>'holder_entity_id', '')) <> 1 then
      raise exception 'Decisions: an appointment needs its role and who is to hold it.';
    end if;
    if nullif(p->>'holder_entity_id', '')::uuid = ent then
      raise exception 'Decisions: an entity can''t hold a role in itself.';
    end if;
  elsif new.action in ('end_appointment', 'note_resignation') then
    select * into a from public.appointments where id = new.appointment_id;
    if a.id is null or a.entity_id <> ent then
      raise exception 'Decisions: choose one of this entity''s appointments.';
    end if;
    if new.action = 'end_appointment' and a.ceased_on is not null then
      raise exception 'Decisions: that appointment has already ended.';
    end if;
    if new.action = 'note_resignation' and a.ceased_on is null then
      raise exception 'Decisions: record the resignation (its date) before noting it.';
    end if;
  elsif new.action = 'share_transaction' and (new.appointment_id is not null or p is not null) then
    raise exception 'Decisions: a share decision is linked from the transaction itself.';
  end if;
  return new;
end;
$$;

-- Runs after the decision rules (name order).
create trigger decisions_rules_action before insert or update on public.decisions
  for each row execute function private.decision_action_rules();

-- When a decision passes, its change follows.
create function private.apply_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ent uuid := private.decision_entity(new.id);
  p jsonb := new.proposed;
  t record;
begin
  if new.action = 'appoint' then
    insert into public.appointments (entity_id, role, person_id, organisation_id, holder_entity_id, appointed_on, resident, identity_verified, notes, basis, decision_id)
    values (
      ent, p->>'role',
      nullif(p->>'person_id', '')::uuid, nullif(p->>'organisation_id', '')::uuid, nullif(p->>'holder_entity_id', '')::uuid,
      -- From the date given, but never before the decision.
      greatest(coalesce(nullif(p->>'appointed_on', '')::date, new.passed_on), new.passed_on),
      coalesce((p->>'resident')::boolean, false), coalesce((p->>'identity_verified')::boolean, false),
      nullif(p->>'notes', ''), 'decision', new.id
    );
  elsif new.action = 'end_appointment' then
    update public.appointments
      set ceased_on = greatest(coalesce(nullif(p->>'ceased_on', '')::date, new.passed_on), new.passed_on)
      where id = new.appointment_id and entity_id = ent and ceased_on is null;
  end if;
  -- Share transactions this decision was drafted for go on the register,
  -- oldest first. (One only linked to an ordinary decision is approved by
  -- hand, as before.)
  if new.action = 'share_transaction' then
    for t in select s.id from public.share_transactions s where s.decision_id = new.id and s.status = 'draft' order by s.transaction_date, s.created_at loop
      update public.share_transactions set status = 'approved' where id = t.id;
    end loop;
  end if;
  return null;
end;
$$;

create trigger decisions_apply after update of passed_on on public.decisions
  for each row when (old.passed_on is null and new.passed_on is not null)
  execute function private.apply_decision();

-- A share transaction decided by a decision drafted for it goes on the
-- register on the date the decision passed, if that is later.
create or replace function private.basis_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  what text := case tg_table_name when 'share_transactions' then 'Shares' else 'Appointments' end;
  passed date;
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
      select d.passed_on into passed from public.decisions d where d.id = new.decision_id and d.action = 'share_transaction';
      if passed is not null and passed > new.transaction_date then
        new.transaction_date := passed;
      end if;
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

revoke all on function private.decision_action_rules(), private.apply_decision() from public;
