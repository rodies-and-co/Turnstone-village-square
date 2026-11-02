-- Turnstone Village Square: distributions and dividends (family database)
--
-- The owner's choices (2 Nov 2026):
--   - Both: trust and foundation distributions to beneficiaries, and company
--     dividends to shareholders (from the register of members).
--   - Each distribution records whether it is paid from the income pool or
--     the capital pool. Pool balances come with Finances (decision 1.3).
--   - Decided, then paid: a distribution or dividend is drafted into a meeting
--     or written resolution, declared once that decision passes, and its
--     payment is then recorded (date, and receipt or voucher reference).
--
-- A dividend is declared per share of one class. When it is declared, a
-- payment line is worked out for every holder of that class on the record
-- date (from the approved transactions), rounded to the penny.

-- ---------------------------------------------------------------------------
-- 1. Decisions can declare these

alter table public.decisions drop constraint decisions_action_check;
alter table public.decisions add constraint decisions_action_check
  check (action in ('appoint', 'end_appointment', 'note_resignation', 'share_transaction', 'distribution', 'dividend'));

-- ---------------------------------------------------------------------------
-- 2. Distributions (trusts and foundations)

create table public.distributions (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  -- To a named beneficiary (a person, firm, entity or charitable cause), or a
  -- member of a class of beneficiaries.
  beneficiary_id uuid references public.beneficiaries (id) on delete restrict,
  class_member_id uuid references public.beneficiary_class_members (id) on delete restrict,
  pool text not null check (pool in ('income', 'capital')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount numeric(20, 2) not null check (amount > 0),
  form text not null default 'cash' check (form in ('cash', 'in_specie', 'loan', 'other')),
  purpose text,
  deed_clause text, -- the clause of the deed or charter that allows it
  letter_of_wishes boolean not null default false, -- the letter of wishes was considered
  decision_id uuid references public.decisions (id) on delete set null,
  status text not null default 'proposed' check (status in ('proposed', 'declared', 'paid', 'cancelled')),
  declared_on date,
  paid_on date,
  receipt_reference text, -- e.g. the signed receipt
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(beneficiary_id, class_member_id) = 1),
  check ((status in ('declared', 'paid')) = (declared_on is not null)),
  check ((status = 'paid') = (paid_on is not null)),
  check (paid_on is null or paid_on >= declared_on)
);
create index distributions_entity on public.distributions (entity_id);
create unique index distributions_one_per_decision on public.distributions (decision_id) where decision_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Dividends (companies and LLCs)

create table public.dividends (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null,
  class_id uuid not null,
  kind text not null default 'final' check (kind in ('interim', 'final', 'special')),
  per_share numeric(20, 6) not null check (per_share > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  record_date date, -- holders on the register that day are paid; empty: the day it is declared
  payment_date date,
  form text not null default 'cash' check (form in ('cash', 'scrip', 'in_specie')),
  decision_id uuid references public.decisions (id) on delete set null,
  status text not null default 'proposed' check (status in ('proposed', 'declared', 'paid', 'cancelled')),
  declared_on date,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (class_id, entity_id) references public.share_classes (id, entity_id) on delete cascade,
  check ((status in ('declared', 'paid')) = (declared_on is not null and record_date is not null))
);
create index dividends_entity on public.dividends (entity_id);
create unique index dividends_one_per_decision on public.dividends (decision_id) where decision_id is not null;

create table public.dividend_payments (
  id uuid primary key default gen_random_uuid(),
  dividend_id uuid not null references public.dividends (id) on delete cascade,
  person_id uuid references public.people (id) on delete restrict,
  organisation_id uuid references public.outside_organisations (id) on delete restrict,
  holder_entity_id uuid references public.entities (id) on delete restrict,
  shares bigint not null check (shares > 0),
  amount numeric(20, 2) not null check (amount >= 0),
  paid_on date,
  voucher text, -- the dividend voucher number
  created_at timestamptz not null default now(),
  check (num_nonnulls(person_id, organisation_id, holder_entity_id) = 1)
);
create unique index dividend_payments_once on public.dividend_payments (dividend_id, coalesce(person_id, organisation_id, holder_entity_id));

-- ---------------------------------------------------------------------------
-- 4. The rules

-- Is the decision one drafted for this kind of record, for this entity, and
-- still open (its meeting or resolution can still change)?
create function private.check_drafted(p_decision uuid, p_entity uuid, p_action text, p_what text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d public.decisions;
  still_open boolean;
begin
  select * into d from public.decisions where id = p_decision;
  if d.id is null or d.action is distinct from p_action then
    raise exception '%: it is decided by a decision drafted for it. Choose a meeting or written resolution.', p_what;
  end if;
  if private.decision_entity(d.id) is distinct from p_entity then
    raise exception '%: the decision must be this entity''s.', p_what;
  end if;
  select case when d.meeting_id is not null
              then exists (select 1 from public.meetings m where m.id = d.meeting_id and m.status in ('planned', 'held'))
              else exists (select 1 from public.written_resolutions w where w.id = d.resolution_id and w.status = 'draft') end
    into still_open;
  if not still_open or d.outcome <> 'proposed' then
    raise exception '%: that decision can no longer change. Choose another meeting or a new resolution.', p_what;
  end if;
end;
$$;

-- Linking a record to a decision counts as changing its meeting or
-- resolution: whoever does it can't also confirm it.
create function private.touch_decision_parent(p_decision uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.decisions;
begin
  select * into d from public.decisions where id = p_decision;
  perform private.touch_parent(d.meeting_id, d.resolution_id);
end;
$$;

-- May a proposed distribution or dividend be cancelled? Only once its
-- decision has gone: not carried, withdrawn, lapsed, cancelled or removed.
create function private.decision_gone(p_decision uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_decision is null or exists (
    select 1 from public.decisions d
    left join public.meetings m on m.id = d.meeting_id
    left join public.written_resolutions w on w.id = d.resolution_id
    where d.id = p_decision
      and (d.outcome in ('not_carried', 'withdrawn') or w.status = 'lapsed'
           or (m.status = 'confirmed' and d.passed_on is null))
  );
$$;

create function private.distribution_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ent public.entities;
  ok boolean;
  payment constant text[] := array['status', 'paid_on', 'receipt_reference', 'notes', 'updated_at'];
begin
  if auth.uid() is null or current_setting('vs.declaring', true) = 'on' or current_setting('vs.unlinking', true) = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    select * into ent from public.entities where id = new.entity_id;
    if ent.entity_type not in ('trust', 'foundation') then
      raise exception 'Distributions: only a trust or foundation makes distributions. A company declares dividends.';
    end if;
    if new.status <> 'proposed' then
      raise exception 'Distributions: a distribution starts as proposed, and is declared when its decision passes.';
    end if;
    -- To a current beneficiary of this trust or foundation.
    if new.beneficiary_id is not null then
      select exists (select 1 from public.beneficiaries b where b.id = new.beneficiary_id and b.entity_id = new.entity_id and b.ceased_on is null) into ok;
    else
      select exists (select 1 from public.beneficiary_class_members m where m.id = new.class_member_id and m.entity_id = new.entity_id and m.ceased_on is null) into ok;
    end if;
    if not ok then
      raise exception 'Distributions: choose a current beneficiary, or a member of a class of beneficiaries, of this trust or foundation.';
    end if;
    if new.decision_id is null then
      raise exception 'Distributions: it is decided by a decision drafted for it. Choose a meeting or written resolution.';
    end if;
    perform private.check_drafted(new.decision_id, new.entity_id, 'distribution', 'Distributions');
    perform private.touch_decision_parent(new.decision_id);
    new.created_by := auth.uid();
    new.declared_on := null;
    new.paid_on := null;
    return new;
  end if;

  if old.status = 'proposed' then
    if new.status = 'cancelled' and (to_jsonb(new) - array['status', 'notes', 'updated_at']) = (to_jsonb(old) - array['status', 'notes', 'updated_at']) then
      if not private.decision_gone(old.decision_id) then
        raise exception 'Distributions: it can be cancelled once its decision is withdrawn, not carried or lapsed.';
      end if;
      return new;
    end if;
    raise exception 'Distributions: a proposed distribution is fixed as drafted. Withdraw its decision and record it again.';
  end if;
  if old.status = 'declared' then
    -- Only the payment is recorded.
    if (to_jsonb(new) - payment) <> (to_jsonb(old) - payment) or new.status not in ('declared', 'paid') then
      raise exception 'Distributions: a declared distribution can''t be changed. Only its payment is recorded.';
    end if;
    if new.status = 'paid' and (new.paid_on is null or new.paid_on > current_date) then
      raise exception 'Distributions: give the date it was paid (not in the future).';
    end if;
    return new;
  end if;
  if (to_jsonb(new) - array['notes', 'updated_at']) <> (to_jsonb(old) - array['notes', 'updated_at']) then
    raise exception 'Distributions: a paid or cancelled distribution can''t be changed.';
  end if;
  return new;
end;
$$;
create trigger distributions_rules before insert or update on public.distributions
  for each row execute function private.distribution_rules();

create function private.dividend_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cls public.share_classes;
begin
  if auth.uid() is null or current_setting('vs.declaring', true) = 'on' or current_setting('vs.unlinking', true) = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    select * into cls from public.share_classes where id = new.class_id and entity_id = new.entity_id;
    if new.status <> 'proposed' then
      raise exception 'Dividends: a dividend starts as proposed, and is declared when its decision passes.';
    end if;
    if new.currency <> cls.currency then
      raise exception 'Dividends: the dividend is paid in the class''s currency (%).', cls.currency;
    end if;
    if new.decision_id is null then
      raise exception 'Dividends: it is decided by a decision drafted for it. Choose a meeting or written resolution.';
    end if;
    perform private.check_drafted(new.decision_id, new.entity_id, 'dividend', 'Dividends');
    perform private.touch_decision_parent(new.decision_id);
    if new.record_date is not null and new.record_date > current_date then
      raise exception 'Dividends: the record date can''t be in the future: the register is taken when the dividend is declared. Leave it empty to use the day it is declared.';
    end if;
    new.created_by := auth.uid();
    new.declared_on := null;
    return new;
  end if;
  if old.status = 'proposed' and new.status = 'cancelled'
     and (to_jsonb(new) - array['status', 'notes', 'updated_at']) = (to_jsonb(old) - array['status', 'notes', 'updated_at']) then
    if not private.decision_gone(old.decision_id) then
      raise exception 'Dividends: it can be cancelled once its decision is withdrawn, not carried or lapsed.';
    end if;
    return new;
  end if;
  if (to_jsonb(new) - array['notes', 'updated_at']) <> (to_jsonb(old) - array['notes', 'updated_at']) then
    raise exception 'Dividends: a dividend is fixed as drafted. Payments are recorded on each holder''s line.';
  end if;
  return new;
end;
$$;
create trigger dividends_rules before insert or update on public.dividends
  for each row execute function private.dividend_rules();

-- Declaring a dividend: a payment line for every holder of the class on the
-- record date.
create function private.declare_dividend(p_decision uuid, p_on date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  dv public.dividends;
  rec_date date;
  lines integer;
begin
  select * into dv from public.dividends where decision_id = p_decision and status = 'proposed';
  if dv.id is null then
    raise exception 'Dividends: the dividend for this decision was cancelled or removed. Record it again, or record the item as not carried.';
  end if;
  rec_date := coalesce(dv.record_date, p_on);
  if rec_date > p_on then
    raise exception 'Dividends: the record date (%) is after the decision (%). The register is taken when it is declared, so the record date must be on or before it.',
      to_char(rec_date, 'DD/MM/YYYY'), to_char(p_on, 'DD/MM/YYYY');
  end if;
  perform set_config('vs.declaring', 'on', true);
  update public.dividends set status = 'declared', declared_on = p_on, record_date = rec_date where id = dv.id;
  insert into public.dividend_payments (dividend_id, person_id, organisation_id, holder_entity_id, shares, amount)
  select dv.id, h.p, h.o, h.e, h.n, round(h.n * dv.per_share, 2)
  from (
    select x.p, x.o, x.e,
      coalesce(sum(case when t.to_person_id is not distinct from x.p and t.to_organisation_id is not distinct from x.o and t.to_entity_id is not distinct from x.e
                        then t.shares else -t.shares end), 0)::bigint as n
    from (select distinct to_person_id as p, to_organisation_id as o, to_entity_id as e
          from public.share_transactions where class_id = dv.class_id and status = 'approved' and kind in ('issue', 'transfer')) x
    join public.share_transactions t on t.class_id = dv.class_id and t.status = 'approved' and t.kind in ('issue', 'transfer') and t.transaction_date <= rec_date
      and ((t.to_person_id is not distinct from x.p and t.to_organisation_id is not distinct from x.o and t.to_entity_id is not distinct from x.e)
           or (t.kind = 'transfer' and t.from_person_id is not distinct from x.p and t.from_organisation_id is not distinct from x.o and t.from_entity_id is not distinct from x.e))
    group by x.p, x.o, x.e
  ) h
  where h.n > 0 and round(h.n * dv.per_share, 2) > 0;
  get diagnostics lines = row_count;
  perform set_config('vs.declaring', 'off', true);
  if lines = 0 then
    raise exception 'Dividends: there were no shares of that class in issue on the record date (%).', to_char(rec_date, 'DD/MM/YYYY');
  end if;
end;
$$;

-- Payments: only the date paid and the voucher are recorded; a dividend is
-- paid once every line is.
create function private.dividend_payment_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  dv public.dividends;
begin
  if auth.uid() is null or current_setting('vs.declaring', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op <> 'UPDATE' then
    raise exception 'Dividends: payment lines are worked out when the dividend is declared.';
  end if;
  if (to_jsonb(new) - array['paid_on', 'voucher']) <> (to_jsonb(old) - array['paid_on', 'voucher']) then
    raise exception 'Dividends: only the date paid and the voucher are recorded.';
  end if;
  if old.paid_on is not null then
    raise exception 'Dividends: a payment already recorded can''t be changed.';
  end if;
  select * into dv from public.dividends where id = new.dividend_id;
  if dv.status not in ('declared', 'paid') then
    raise exception 'Dividends: payments are recorded once the dividend is declared.';
  end if;
  if new.paid_on is not null and (new.paid_on < dv.declared_on or new.paid_on > current_date) then
    raise exception 'Dividends: the date paid is between the day it was declared (%) and today.', to_char(dv.declared_on, 'DD/MM/YYYY');
  end if;
  return new;
end;
$$;
create trigger dividend_payments_rules before insert or update or delete on public.dividend_payments
  for each row execute function private.dividend_payment_rules();

create function private.dividend_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('vs.declaring', 'on', true);
  update public.dividends d
    set status = case when not exists (select 1 from public.dividend_payments p where p.dividend_id = d.id and p.paid_on is null) then 'paid' else 'declared' end
    where d.id = new.dividend_id and d.status in ('declared', 'paid');
  perform set_config('vs.declaring', 'off', true);
  return null;
end;
$$;
create trigger dividend_payments_paid after update of paid_on on public.dividend_payments
  for each row execute function private.dividend_paid();

-- ---------------------------------------------------------------------------
-- 5. Row-level security

alter table public.distributions enable row level security;
alter table public.dividends enable row level security;
alter table public.dividend_payments enable row level security;

-- A distribution is seen by whoever may see the beneficiary it goes to.
create policy "distributions: read" on public.distributions
  for select to authenticated using (
    private.can_see_entity_id(entity_id)
    and (exists (select 1 from public.beneficiaries b where b.id = beneficiary_id)
         or exists (select 1 from public.beneficiary_class_members m where m.id = class_member_id))
  );
create policy "dividends: read" on public.dividends
  for select to authenticated using (private.can_see_entity_id(entity_id));
create policy "dividend_payments: read" on public.dividend_payments
  for select to authenticated using (
    exists (select 1 from public.dividends d where d.id = dividend_id)
    and (person_id is null or private.can_see_person_id(person_id))
  );

do $$
declare
  t text;
begin
  foreach t in array array['distributions', 'dividends', 'dividend_payments'] loop
    execute format('create policy "%1$s: editors add" on public.%1$I for insert to authenticated with check (private.can_edit())', t);
    execute format('create policy "%1$s: editors change" on public.%1$I for update to authenticated using (private.can_edit()) with check (private.can_edit())', t);
    -- No delete rule: a record is removed only by two people (removal requests).
    execute format('create trigger %1$s_log after insert or update or delete on public.%1$I for each row execute function private.log_change()', t);
    execute format('revoke all on public.%1$I from anon', t);
  end loop;
end;
$$;
create trigger distributions_updated_at before update on public.distributions
  for each row execute function private.touch_updated_at();
create trigger dividends_updated_at before update on public.dividends
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Decisions that declare them, unlinking, and removals

create or replace function private.decision_action_rules()
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
  elsif new.action in ('share_transaction', 'distribution', 'dividend') and (new.appointment_id is not null or p is not null) then
    raise exception 'Decisions: this kind of decision is linked from the transaction, distribution or dividend itself.';
  end if;
  return new;
end;
$$;

create or replace function private.apply_decision()
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
  -- Distributions and dividends this decision was drafted for are declared.
  if new.action = 'distribution' then
    perform set_config('vs.declaring', 'on', true);
    update public.distributions set status = 'declared', declared_on = new.passed_on where decision_id = new.id and status = 'proposed';
    get diagnostics changed = row_count;
    perform set_config('vs.declaring', 'off', true);
    if changed = 0 then
      raise exception 'Distributions: the distribution for this decision was cancelled or removed. Record it again, or record the item as not carried.';
    end if;
  elsif new.action = 'dividend' then
    perform private.declare_dividend(new.id, new.passed_on);
  end if;
  exception when others then
    raise exception 'Decisions: item % ("%") couldn''t take effect: %. Put it right, or record it as not carried, then try again.',
      new.item, new.title, regexp_replace(sqlerrm, '^(Shares|Appointments|Decisions|Distributions|Dividends): ', '');
  end;
  return null;
end;
$$;

create or replace function private.decision_unlink()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('vs.unlinking', 'on', true);
  update public.share_transactions set basis = null, decision_id = null where decision_id = old.id and status = 'draft';
  update public.distributions set decision_id = null where decision_id = old.id and status = 'proposed';
  update public.dividends set decision_id = null where decision_id = old.id and status = 'proposed';
  perform set_config('vs.unlinking', 'off', true);
  return old;
end;
$$;

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
    ('dividends', 'Proposed dividend', 'id')
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

-- A distribution's item names the beneficiary: it is hidden from a Viewer
-- who can't see that beneficiary.
drop policy "decisions: read" on public.decisions;
create policy "decisions: read" on public.decisions
  for select to authenticated using (
    case when meeting_id is not null then private.can_see_meeting(meeting_id) else private.can_see_resolution(resolution_id) end
    and (action is distinct from 'distribution' or private.can_edit() or exists (select 1 from public.distributions x where x.decision_id = id))
  );

revoke all on function private.touch_decision_parent(uuid), private.check_drafted(uuid, uuid, text, text), private.decision_gone(uuid), private.distribution_rules(),
  private.dividend_rules(), private.declare_dividend(uuid, date), private.dividend_payment_rules(), private.dividend_paid() from public;
