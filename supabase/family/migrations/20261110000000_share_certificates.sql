-- Turnstone Village Square: share certificates numbered automatically (family database)
--
-- Share certificate numbers follow one after the other in each class, in the
-- order transactions are approved (which is date order). They are given when
-- a transaction is approved, so a draft that is removed leaves no gap. A
-- transfer gets the next number for the new holder, and the one after for
-- the transferor's balance certificate if they keep any shares.

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
  -- some shares. A number already on the draft (e.g. from an older record) is kept.
  if new.kind in ('issue', 'transfer') then
    select coalesce(max(n), 0) into next_number from (
      select t.certificate_number::bigint as n from public.share_transactions t
      where t.class_id = new.class_id and t.status = 'approved' and t.certificate_number ~ '^[0-9]{1,15}$'
      union all
      select t.balance_certificate_number::bigint from public.share_transactions t
      where t.class_id = new.class_id and t.status = 'approved' and t.balance_certificate_number ~ '^[0-9]{1,15}$'
    ) used;
    if new.certificate_number is null then
      next_number := next_number + 1;
      new.certificate_number := next_number::text;
    end if;
    if new.kind = 'transfer' and new.balance_certificate_number is null and held > new.shares then
      next_number := greatest(next_number, coalesce(nullif(regexp_replace(new.certificate_number, '[^0-9]', '', 'g'), '')::bigint, 0)) + 1;
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
