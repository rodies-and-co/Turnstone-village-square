-- Turnstone Village Square: fixes from the independent review (family database)
--
-- 1. Viewers see only the service providers that serve something they may see
--    (Managers and Administrators see them all).
-- 2. Certificate numbers are always the next in order when a transaction is
--    approved, even if an older draft carried a number.
-- 3. A family entity or a service provider that still holds a current
--    appointment can't be removed (end the appointment first). Past
--    appointments go with it on removal, and a copy is kept with the request.
-- 4. Removal requests name a family entity that holds a role.
-- 5. Practice families are marked, so practice-only scripts can tell them
--    apart from real families. The mark can't be changed afterwards.

-- 1. Service providers -------------------------------------------------------

create function private.can_see_provider(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_edit()
    or exists (select 1 from public.appointments a where a.organisation_id = p_org and private.can_see_entity_id(a.entity_id))
    or exists (select 1 from public.share_transactions t
               where (t.to_organisation_id = p_org or t.from_organisation_id = p_org) and private.can_see_entity_id(t.entity_id))
    or exists (select 1 from public.settlements s where s.organisation_id = p_org and private.can_see_entity_id(s.entity_id))
    or exists (select 1 from public.beneficiaries b where b.organisation_id = p_org and private.can_see_entity_id(b.entity_id));
$$;
revoke all on function private.can_see_provider(uuid) from public;
grant execute on function private.can_see_provider(uuid) to authenticated;

drop policy "outside_organisations: read" on public.outside_organisations;
create policy "outside_organisations: read" on public.outside_organisations
  for select to authenticated using (private.can_see_provider(id));

-- 2. Certificate numbers -----------------------------------------------------

create or replace function private.share_transaction_rules()
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
  next_number bigint;
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

  -- Certificates are numbered here, in the order transactions are approved
  -- (which is date order), one after the other in each class: the new
  -- certificate first, then the balance certificate if the transferor keeps
  -- some shares.
  if new.kind in ('issue', 'transfer') then
    select coalesce(max(n), 0) into next_number from (
      select t.certificate_number::bigint as n from public.share_transactions t
      where t.class_id = new.class_id and t.status = 'approved' and t.certificate_number ~ '^[0-9]{1,15}$'
      union all
      select t.balance_certificate_number::bigint from public.share_transactions t
      where t.class_id = new.class_id and t.status = 'approved' and t.balance_certificate_number ~ '^[0-9]{1,15}$'
    ) used;
    -- Always the next numbers, even if an older draft carried a number.
    next_number := next_number + 1;
    new.certificate_number := next_number::text;
    new.balance_certificate_number := null;
    if new.kind = 'transfer' and held > new.shares then
      next_number := next_number + 1;
      new.balance_certificate_number := next_number::text;
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

-- 3. Removing entities and providers that hold roles --------------------------

alter table public.appointments drop constraint appointments_holder_entity_id_fkey;
alter table public.appointments
  add constraint appointments_holder_entity_id_fkey foreign key (holder_entity_id) references public.entities (id) on delete cascade;

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
end;
$$;
revoke all on function private.removal_allowed(text, uuid, jsonb) from public;

-- 4. Removal summaries ---------------------------------------------------------

create or replace function private.removal_summary(p_table text, r jsonb)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  parts text[] := '{}';
  own text;
  person_name text;
  p uuid;
begin
  own := coalesce(
    r->>'name', r->>'title', r->>'cause',
    nullif(trim(coalesce(r->>'known_as', split_part(r->>'full_names', ' ', 1), '') || ' ' || coalesce(r->>'surname', '')), ''),
    case when r ? 'number' then trim(coalesce(r->>'country', '') || ' ' || (r->>'number')) end,
    case when r ? 'line1' then (r->>'line1') || ', ' || (r->>'city') end
  );
  if own is not null then parts := parts || own; end if;
  foreach p in array array[
    nullif(r->>'person_id', '')::uuid, nullif(r->>'parent_id', '')::uuid, nullif(r->>'child_id', '')::uuid,
    nullif(r->>'person_a', '')::uuid, nullif(r->>'person_b', '')::uuid,
    nullif(r->>'to_person_id', '')::uuid, nullif(r->>'from_person_id', '')::uuid
  ] loop
    if p is not null then
      select trim(coalesce(x.known_as, split_part(x.full_names, ' ', 1)) || ' ' || x.surname) into person_name from public.people x where x.id = p;
      if person_name is not null then parts := parts || person_name; end if;
    end if;
  end loop;
  if r ? 'organisation_id' and r->>'organisation_id' is not null then
    parts := parts || (select o.name from public.outside_organisations o where o.id = (r->>'organisation_id')::uuid);
  end if;
  if r ? 'holder_entity_id' and r->>'holder_entity_id' is not null then
    parts := parts || (select e.name from public.entities e where e.id = (r->>'holder_entity_id')::uuid);
  end if;
  if r ? 'entity_id' and r->>'entity_id' is not null then
    parts := parts || (select e.name from public.entities e where e.id = (r->>'entity_id')::uuid);
  end if;
  return (select label from private.removable(p_table))
    || coalesce(' (' || coalesce(r->>'role', r->>'kind') || ')', '')
    || coalesce(': ' || nullif(array_to_string(parts, ', '), ''), '');
end;
$$;
revoke all on function private.removal_summary(text, jsonb) from public;

-- 5. Practice families ------------------------------------------------------------

alter table public.family_settings add column is_practice boolean not null default false;
-- The two practice families in use today. New databases are never practice
-- unless created as one.
update public.family_settings set is_practice = true where family_name in ('Hartley', 'Visser');

create function private.practice_mark_is_fixed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_practice is distinct from old.is_practice then
    raise exception 'Whether this is a practice family can''t be changed.';
  end if;
  return new;
end;
$$;
revoke all on function private.practice_mark_is_fixed() from public;
create trigger family_settings_practice_fixed before update of is_practice on public.family_settings
  for each row execute function private.practice_mark_is_fixed();
