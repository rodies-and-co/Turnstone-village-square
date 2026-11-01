-- Turnstone Village Square: The Organisation, step 2 – Ownership (family database)
--
-- Who owns and benefits from each entity.
--
-- Companies and LLCs: share classes, and a ledger of share transactions
-- (authorising shares, issuing shares, transferring shares). The register of
-- members and the share certificates are worked out from the approved
-- transactions, so a holding is never typed in twice.
--
-- Trusts and foundations: settlements (by settlors, or the founder of a
-- foundation, including additions to the capital later), beneficiaries
-- (individuals, organisations, family entities and charitable causes) and
-- classes of beneficiaries (e.g. "the descendants of Tom Hartley").
--
-- A holder is a person in the Tree, an outside organisation, or another of
-- the family's entities (so entities can own entities, for the structure
-- chart and for working out beneficial owners through a chain).
--
-- Approval: a share transaction is recorded as a draft by a Manager or
-- Administrator, and approved by a Manager who didn't prepare it (as it
-- would be by a minute or resolution; the reference is recorded). Only
-- approved transactions count. Approved transactions can't be changed or
-- removed: a mistake is put right by another transaction.
--
-- Who sees what follows the entity: Managers and Administrators see all;
-- Viewers with whole-family access, or with access to the entity's branch.
-- Rows that name a person the Viewer can't see are hidden from them, except
-- in the share ledger, where the holder is shown without a name so that the
-- register adds up.

alter table public.outside_organisations add column incorporated_on date;

-- ---------------------------------------------------------------------------
-- Only the right kind of entity: share classes for companies and LLCs,
-- settlements and beneficiaries for trusts and foundations.

create function private.check_entity_kind()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  kind text;
begin
  select e.entity_type into kind from public.entities e where e.id = new.entity_id;
  if kind is not null and not (kind = any (tg_argv)) then
    raise exception 'Ownership: this can''t be recorded for a %.', kind;
  end if;
  return new;
end;
$$;
revoke all on function private.check_entity_kind() from public;

-- ---------------------------------------------------------------------------
-- Share classes

create table public.share_classes (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  par_value numeric(20, 6) check (par_value is null or par_value >= 0), -- null: no par value
  limited boolean not null default true, -- true: shares can't be issued beyond those authorised
  voting boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  unique (id, entity_id)
);
create unique index share_classes_name on public.share_classes (entity_id, lower(name));

-- The first class sets the company's base currency, if it has none yet.
create function private.share_class_sets_currency()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.entities set base_currency = new.currency where id = new.entity_id and base_currency is null;
  return new;
end;
$$;
revoke all on function private.share_class_sets_currency() from public;

-- Once shares of a class have been approved, its currency and par value are
-- part of the record and can't change, and the class can't be removed
-- (unless the whole entity is being removed).
create function private.share_class_is_settled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.share_transactions t where t.class_id = old.id and t.status = 'approved') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from public.entities e where e.id = old.entity_id) then
      raise exception 'Shares: this class has approved transactions, so it can''t be removed.';
    end if;
    return old;
  end if;
  if new.currency is distinct from old.currency or new.par_value is distinct from old.par_value or new.entity_id is distinct from old.entity_id
     or new.limited is distinct from old.limited or new.voting is distinct from old.voting then
    raise exception 'Shares: this class has approved transactions, so its currency, par value, limit and votes can''t change. Record a new class instead.';
  end if;
  return new;
end;
$$;
revoke all on function private.share_class_is_settled() from public;

-- ---------------------------------------------------------------------------
-- Share transactions: the ledger

create table public.share_transactions (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  class_id uuid not null,
  kind text not null check (kind in ('authorise', 'issue', 'transfer')),
  transaction_date date not null,
  shares bigint not null check (shares > 0),
  -- Who receives the shares (issue and transfer).
  to_person_id uuid references public.people (id) on delete restrict,
  to_organisation_id uuid references public.outside_organisations (id) on delete restrict,
  to_entity_id uuid references public.entities (id) on delete restrict,
  -- Who gives them up (transfer).
  from_person_id uuid references public.people (id) on delete restrict,
  from_organisation_id uuid references public.outside_organisations (id) on delete restrict,
  from_entity_id uuid references public.entities (id) on delete restrict,
  certificate_number text check (certificate_number is null or length(trim(certificate_number)) > 0),
  balance_certificate_number text check (balance_certificate_number is null or length(trim(balance_certificate_number)) > 0),
  consideration numeric(20, 2) check (consideration is null or consideration >= 0),
  resolution text, -- the minute or resolution that approved it
  status text not null default 'draft' check (status in ('draft', 'approved')),
  prepared_by uuid,
  edited_by uuid[] not null default '{}', -- everyone who recorded or changed the draft: none of them may approve it
  approved_by uuid,
  approved_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (class_id, entity_id) references public.share_classes (id, entity_id) on delete cascade,
  check (
    case kind
      when 'authorise' then num_nonnulls(to_person_id, to_organisation_id, to_entity_id, from_person_id, from_organisation_id, from_entity_id) = 0
      when 'issue' then num_nonnulls(to_person_id, to_organisation_id, to_entity_id) = 1
                        and num_nonnulls(from_person_id, from_organisation_id, from_entity_id) = 0
      else num_nonnulls(to_person_id, to_organisation_id, to_entity_id) = 1
           and num_nonnulls(from_person_id, from_organisation_id, from_entity_id) = 1
    end
  ),
  check (kind <> 'authorise' or (certificate_number is null and balance_certificate_number is null)),
  check (kind = 'transfer' or balance_certificate_number is null),
  check (to_entity_id is distinct from entity_id and from_entity_id is distinct from entity_id),
  check ((status = 'approved') = (approved_by is not null and approved_at is not null))
);
create index share_transactions_entity on public.share_transactions (entity_id);
create index share_transactions_class on public.share_transactions (class_id);

-- Shares a holder has in a class, from the approved transactions.
create function private.shares_held(p_class uuid, p_person uuid, p_org uuid, p_entity uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(case
    when t.to_person_id is not distinct from p_person and t.to_organisation_id is not distinct from p_org
         and t.to_entity_id is not distinct from p_entity then t.shares
    else -t.shares end), 0)::bigint
  from public.share_transactions t
  where t.class_id = p_class and t.status = 'approved' and t.kind in ('issue', 'transfer')
    and (
      (t.to_person_id is not distinct from p_person and t.to_organisation_id is not distinct from p_org and t.to_entity_id is not distinct from p_entity)
      or (t.kind = 'transfer' and t.from_person_id is not distinct from p_person and t.from_organisation_id is not distinct from p_org
          and t.from_entity_id is not distinct from p_entity)
    );
$$;
revoke all on function private.shares_held(uuid, uuid, uuid, uuid) from public;

-- The rules for the ledger.
create function private.share_transaction_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cls public.share_classes;
  authorised bigint;
  issued bigint;
  held bigint;
begin
  if auth.uid() is null and tg_op = 'INSERT' then
    return new; -- set-up scripts run by the database owner
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'Shares: a transaction starts as a draft. A Manager who didn''t prepare it approves it.';
    end if;
    new.prepared_by := auth.uid();
    new.edited_by := array[auth.uid()];
    new.approved_by := null;
    new.approved_at := null;
    return new;
  end if;

  if old.status = 'approved' then
    raise exception 'Shares: an approved transaction can''t be changed. Record another transaction to put it right.';
  end if;

  -- Approval details are only ever set below.
  new.prepared_by := old.prepared_by;
  new.edited_by := old.edited_by;
  new.approved_by := null;
  new.approved_at := null;
  new.updated_at := old.updated_at;

  if new.status = 'draft' then
    -- Whoever changes a draft (even without changing anything) becomes its
    -- preparer, and joins the people who may not approve it.
    new.prepared_by := auth.uid();
    if not (auth.uid() = any (old.edited_by)) then
      new.edited_by := old.edited_by || auth.uid();
    end if;
    new.updated_at := now();
    return new;
  end if;

  -- Approving.
  if not private.can_manage() then
    raise exception 'Shares: only a Manager can approve a share transaction.';
  end if;
  if auth.uid() is null or auth.uid() is not distinct from old.prepared_by or auth.uid() = any (old.edited_by) then
    raise exception 'Shares: whoever prepared a transaction can''t also approve it. Ask another Manager.';
  end if;
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'Shares: approve the transaction as it was prepared. Change it first, then ask another Manager to approve it.';
  end if;

  -- One approval at a time per class, so the checks below can't be raced.
  select * into cls from public.share_classes c where c.id = new.class_id for update;

  -- Transactions are approved in date order, so every check below holds on
  -- the transaction's own date.
  if exists (select 1 from public.share_transactions t
             where t.class_id = new.class_id and t.status = 'approved' and t.transaction_date > new.transaction_date) then
    raise exception 'Shares: this class already has an approved transaction dated after %. Transactions are approved in date order.',
      to_char(new.transaction_date, 'FMDD Month YYYY');
  end if;

  if new.kind = 'issue' then
    if cls.limited then
      select coalesce(sum(t.shares) filter (where t.kind = 'authorise'), 0), coalesce(sum(t.shares) filter (where t.kind = 'issue'), 0)
        into authorised, issued
      from public.share_transactions t where t.class_id = new.class_id and t.status = 'approved';
      if issued + new.shares > authorised then
        raise exception 'Shares: issuing % would take the % shares beyond the % authorised (% issued already). Authorise more shares first.',
          new.shares, cls.name, authorised, issued;
      end if;
    end if;
  elsif new.kind = 'transfer' then
    if new.to_person_id is not distinct from new.from_person_id and new.to_organisation_id is not distinct from new.from_organisation_id
       and new.to_entity_id is not distinct from new.from_entity_id then
      raise exception 'Shares: a transfer needs two different holders.';
    end if;
    held := private.shares_held(new.class_id, new.from_person_id, new.from_organisation_id, new.from_entity_id);
    if held < new.shares then
      raise exception 'Shares: the transferor holds % % shares, so % can''t be transferred.', held, cls.name, new.shares;
    end if;
  end if;

  -- Certificate numbers are used once in a class.
  if exists (
    select 1 from public.share_transactions t
    where t.class_id = new.class_id and t.status = 'approved'
      and (t.certificate_number in (new.certificate_number, new.balance_certificate_number)
           or t.balance_certificate_number in (new.certificate_number, new.balance_certificate_number))
  ) or new.certificate_number = new.balance_certificate_number then
    raise exception 'Shares: that certificate number has already been used for this class.';
  end if;

  new.approved_by := auth.uid();
  new.approved_at := now();
  return new;
end;
$$;
revoke all on function private.share_transaction_rules() from public;

-- ---------------------------------------------------------------------------
-- Trusts and foundations: settlements, beneficiaries and classes

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  kind text not null default 'initial' check (kind in ('initial', 'additional')),
  person_id uuid references public.people (id) on delete restrict,
  organisation_id uuid references public.outside_organisations (id) on delete restrict,
  holder_entity_id uuid references public.entities (id) on delete restrict,
  settled_on date,
  description text, -- what was settled, e.g. "R100 cash" or "shares in Hartley Holdings"
  amount numeric(20, 2) check (amount is null or amount >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  notes text,
  created_at timestamptz not null default now(),
  check (num_nonnulls(person_id, organisation_id, holder_entity_id) = 1),
  check (holder_entity_id is distinct from entity_id),
  check (amount is null or currency is not null)
);
create index settlements_entity on public.settlements (entity_id);

create table public.beneficiary_classes (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text,
  created_at timestamptz not null default now(),
  unique (id, entity_id)
);
create unique index beneficiary_classes_name on public.beneficiary_classes (entity_id, lower(name));

create table public.beneficiary_class_members (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null,
  class_id uuid not null,
  person_id uuid not null references public.people (id) on delete restrict,
  added_on date,
  ceased_on date,
  created_at timestamptz not null default now(),
  foreign key (class_id, entity_id) references public.beneficiary_classes (id, entity_id) on delete cascade,
  check (ceased_on is null or added_on is null or ceased_on >= added_on)
);
create unique index beneficiary_class_members_current on public.beneficiary_class_members (class_id, person_id) where ceased_on is null;

create table public.beneficiaries (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  person_id uuid references public.people (id) on delete restrict,
  organisation_id uuid references public.outside_organisations (id) on delete restrict,
  holder_entity_id uuid references public.entities (id) on delete restrict,
  cause text check (cause is null or length(trim(cause)) > 0), -- a charitable cause
  interest text not null default 'discretionary' check (interest in ('discretionary', 'fixed', 'default', 'contingent', 'other')),
  share_percent numeric(5, 2) check (share_percent is null or (share_percent > 0 and share_percent <= 100)),
  added_on date,
  ceased_on date,
  notes text,
  created_at timestamptz not null default now(),
  check (num_nonnulls(person_id, organisation_id, holder_entity_id, cause) = 1),
  check (holder_entity_id is distinct from entity_id),
  check (ceased_on is null or added_on is null or ceased_on >= added_on)
);
create index beneficiaries_entity on public.beneficiaries (entity_id);
create unique index beneficiaries_current on public.beneficiaries
  (entity_id, coalesce(person_id, organisation_id, holder_entity_id)) where ceased_on is null and cause is null;
create unique index beneficiaries_current_cause on public.beneficiaries (entity_id, lower(trim(cause))) where ceased_on is null and cause is not null;

-- An entity's kind (company, trust…) is fixed once it is created: its share
-- capital or its settlements and beneficiaries depend on it.
create function private.entity_kind_is_fixed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.entity_type is distinct from old.entity_type then
    raise exception 'Ownership: the kind of entity can''t change once it is recorded.';
  end if;
  return new;
end;
$$;
revoke all on function private.entity_kind_is_fixed() from public;
create trigger entities_kind_fixed before update of entity_type on public.entities
  for each row execute function private.entity_kind_is_fixed();

-- ---------------------------------------------------------------------------
-- Triggers

create trigger share_classes_kind before insert or update of entity_id on public.share_classes
  for each row execute function private.check_entity_kind('company', 'llc');
create trigger share_classes_currency after insert on public.share_classes
  for each row execute function private.share_class_sets_currency();
create trigger share_classes_settled before update or delete on public.share_classes
  for each row execute function private.share_class_is_settled();
create trigger share_transactions_rules before insert or update on public.share_transactions
  for each row execute function private.share_transaction_rules();
create trigger settlements_kind before insert or update of entity_id on public.settlements
  for each row execute function private.check_entity_kind('trust', 'foundation');
create trigger beneficiary_classes_kind before insert or update of entity_id on public.beneficiary_classes
  for each row execute function private.check_entity_kind('trust', 'foundation');
create trigger beneficiaries_kind before insert or update of entity_id on public.beneficiaries
  for each row execute function private.check_entity_kind('trust', 'foundation');

-- ---------------------------------------------------------------------------
-- Row-level security

alter table public.share_classes enable row level security;
alter table public.share_transactions enable row level security;
alter table public.settlements enable row level security;
alter table public.beneficiary_classes enable row level security;
alter table public.beneficiary_class_members enable row level security;
alter table public.beneficiaries enable row level security;

create function private.can_see_entity_id(p_entity uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.entities e where e.id = p_entity and private.can_see_entity_branch(e.branch_id));
$$;
revoke all on function private.can_see_entity_id(uuid) from public;
grant execute on function private.can_see_entity_id(uuid) to authenticated;

create policy "share_classes: read" on public.share_classes
  for select to authenticated using (private.can_see_entity_id(entity_id));
-- The whole ledger is shown to whoever may see the entity, so the register
-- adds up. A holder the Viewer can't see in the Tree is shown without a name.
create policy "share_transactions: read" on public.share_transactions
  for select to authenticated using (private.can_see_entity_id(entity_id));
create policy "settlements: read" on public.settlements
  for select to authenticated using (private.can_see_entity_id(entity_id) and (person_id is null or private.can_see_person_id(person_id)));
create policy "beneficiary_classes: read" on public.beneficiary_classes
  for select to authenticated using (private.can_see_entity_id(entity_id));
create policy "beneficiary_class_members: read" on public.beneficiary_class_members
  for select to authenticated using (private.can_see_entity_id(entity_id) and private.can_see_person_id(person_id));
create policy "beneficiaries: read" on public.beneficiaries
  for select to authenticated using (private.can_see_entity_id(entity_id) and (person_id is null or private.can_see_person_id(person_id)));

do $$
declare
  t text;
begin
  foreach t in array array['share_classes', 'share_transactions', 'settlements', 'beneficiary_classes', 'beneficiary_class_members', 'beneficiaries'] loop
    execute format('create policy "%1$s: editors add" on public.%1$I for insert to authenticated with check (private.can_edit())', t);
    execute format('create policy "%1$s: editors change" on public.%1$I for update to authenticated using (private.can_edit()) with check (private.can_edit())', t);
    if t = 'share_transactions' then
      -- Only drafts can be removed; approved transactions are the record.
      execute format('create policy "%1$s: managers remove drafts" on public.%1$I for delete to authenticated using (private.can_manage() and status = ''draft'')', t);
    else
      execute format('create policy "%1$s: managers remove" on public.%1$I for delete to authenticated using (private.can_manage())', t);
    end if;
    execute format('create trigger %1$s_log after insert or update or delete on public.%1$I for each row execute function private.log_change()', t);
    execute format('revoke all on public.%1$I from anon', t);
  end loop;
end;
$$;
