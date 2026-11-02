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
  add column appointment_id uuid references public.appointments (id) on delete restrict,
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
  if tg_op = 'UPDATE' and (new.action, new.appointment_id, new.proposed) is distinct from (old.action, old.appointment_id, old.proposed) then
    raise exception 'Decisions: what a decision will change can''t be altered. Withdraw it and record the change again.';
  end if;
  -- A drafted change keeps the wording it was drafted with, so the minute or
  -- resolution always says what will happen.
  if tg_op = 'UPDATE' and new.action is not null and (new.title, new.wording) is distinct from (old.title, old.wording) then
    raise exception 'Decisions: the wording of a drafted change can''t be edited. Withdraw it and record the change again.';
  end if;
  if new.action is null then
    if new.appointment_id is not null or new.proposed is not null then
      raise exception 'Decisions: only a decision that changes something carries its details.';
    end if;
    return new;
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
    if p->>'role' not in ('director', 'alternate_director', 'secretary', 'nominated_officer', 'registered_agent', 'management_company',
        'public_officer', 'auditor', 'accounting_officer', 'trustee', 'protector', 'enforcer', 'council_member',
        'designated_member', 'member', 'manager', 'general_partner', 'limited_partner')
       or coalesce(jsonb_typeof(p->'resident'), 'boolean') <> 'boolean' or coalesce(jsonb_typeof(p->'identity_verified'), 'boolean') <> 'boolean'
       or (nullif(p->>'appointed_on', '') is not null and (p->>'appointed_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then
      raise exception 'Decisions: the appointment''s details aren''t right. Record it again.';
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
  elsif new.action = 'end_appointment' and nullif(p->>'ceased_on', '') is not null and (p->>'ceased_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Decisions: the date of the removal isn''t right.';
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
  changed integer;
begin
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
    get diagnostics changed = row_count;
    if changed = 0 then
      raise exception 'that appointment has already ended';
    end if;
  end if;
  -- Share transactions this decision was drafted for go on the register,
  -- oldest first. (One only linked to an ordinary decision is approved by
  -- hand, as before.)
  if new.action = 'share_transaction' then
    for t in select s.id from public.share_transactions s where s.decision_id = new.id and s.status = 'draft' order by s.transaction_date, s.created_at loop
      update public.share_transactions set status = 'approved' where id = t.id;
    end loop;
  end if;
  exception when others then
    raise exception 'Decisions: item % ("%") couldn''t take effect: %. Put it right, or record it as not carried, then try again.',
      new.item, new.title, regexp_replace(sqlerrm, '^(Shares|Appointments|Decisions): ', '');
  end;
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

-- A share transaction linked to a decision drafted for it is fixed: what
-- goes on the register is what the decision says. One transaction per
-- drafted decision, linked only while the decision can still change.
create function private.share_link_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.decisions;
  still_open boolean;
  ignore constant text[] := array['status', 'transaction_date', 'approved_by', 'approved_at', 'certificate_number',
    'balance_certificate_number', 'prepared_by', 'edited_by', 'updated_at'];
begin
  if auth.uid() is null or current_setting('vs.unlinking', true) = 'on' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.decision_id is not null and old.status = 'draft'
     and exists (select 1 from public.decisions x where x.id = old.decision_id and x.action = 'share_transaction') then
    -- Only its approval (when the decision passes) may change it.
    if not (new.status = 'approved' and (to_jsonb(new) - ignore) = (to_jsonb(old) - ignore)) then
      raise exception 'Shares: this transaction was drafted into a decision, so it can''t be changed. Withdraw that item and record the transaction again.';
    end if;
    return new;
  end if;
  if new.decision_id is not null and (tg_op = 'INSERT' or new.decision_id is distinct from old.decision_id) then
    select * into d from public.decisions where id = new.decision_id;
    if d.action = 'share_transaction' then
      if exists (select 1 from public.share_transactions s where s.decision_id = d.id and s.id <> new.id) then
        raise exception 'Shares: that decision already has its transaction. Record a new decision for this one.';
      end if;
      select case when d.meeting_id is not null
                  then exists (select 1 from public.meetings m where m.id = d.meeting_id and m.status in ('planned', 'held'))
                  else exists (select 1 from public.written_resolutions w where w.id = d.resolution_id and w.status = 'draft') end
        into still_open;
      if not still_open or d.outcome <> 'proposed' then
        raise exception 'Shares: that decision can no longer take a transaction. Choose another meeting or a new resolution.';
      end if;
    end if;
  end if;
  return new;
end;
$$;
-- Runs before the share transaction rules (name order).
create trigger share_transactions_link before insert or update on public.share_transactions
  for each row execute function private.share_link_rules();

-- Removing a draft decision (with its meeting or resolution) unlinks the
-- draft transactions that relied on it; they wait for a new decision.
create function private.decision_unlink()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('vs.unlinking', 'on', true);
  update public.share_transactions set basis = null, decision_id = null where decision_id = old.id and status = 'draft';
  perform set_config('vs.unlinking', 'off', true);
  return old;
end;
$$;
create trigger decisions_unlink before delete on public.decisions
  for each row execute function private.decision_unlink();

-- An appointment named in a decision is kept with it.
create or replace function private.removal_allowed(p_table text, p_id uuid, rec jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
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

revoke all on function private.decision_action_rules(), private.apply_decision(), private.share_link_rules(), private.decision_unlink() from public;

