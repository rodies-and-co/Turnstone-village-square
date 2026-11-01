-- Turnstone Village Square: two people for every removal (family database)
--
-- Nothing in a family's records is removed by one person alone. A Manager or
-- Administrator asks for a removal; a Manager (or the Super User) who didn't
-- ask approves it, and only then is the record removed. A copy of what was
-- removed is kept with the request, and every step is in the history.
--
-- One exception: taking away a Viewer's access (access_grants) stays
-- immediate, because a delay would leave someone with access they should
-- no longer have.
--
-- Nobody can remove records directly through the API any more: the direct
-- "remove" rules are dropped, and removals happen only through
-- decide_removal() below.

create table public.removal_requests (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid not null,
  summary text not null,     -- what is to be removed, in words (worked out here, not typed in)
  snapshot jsonb not null,   -- the record as it was when the removal was asked for
  goes_with jsonb not null default '[]', -- the records that would be removed with it, as they were
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  check ((status = 'pending') = (decided_by is null and decided_at is null))
);
create unique index removal_requests_pending on public.removal_requests (table_name, record_id) where status = 'pending';
create index removal_requests_status on public.removal_requests (status, requested_at);

alter table public.removal_requests enable row level security;
-- Managers and Administrators see the requests; nobody writes them directly.
create policy "removal_requests: editors read" on public.removal_requests
  for select to authenticated using (private.can_edit());
revoke all on public.removal_requests from anon;
create trigger removal_requests_log after insert or update or delete on public.removal_requests
  for each row execute function private.log_change();

-- What may be removed, how each kind is named, and its key.
create function private.removable(p_table text)
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
    ('beneficiary_class_members', 'Member of a class of beneficiaries', 'id')
  ) as v (table_name, label, key_column)
  where v.table_name = p_table;
$$;
revoke all on function private.removable(text) from public;

-- The record, as JSON, or null if it isn't there.
create function private.removal_target(p_table text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k text := (select r.key_column from private.removable(p_table) r);
  rec jsonb;
begin
  if k is null then
    raise exception 'Removal: that kind of record can''t be removed.';
  end if;
  execute format('select to_jsonb(t) from public.%I t where t.%I = $1', p_table, k) into rec using p_id;
  return rec;
end;
$$;
revoke all on function private.removal_target(text, uuid) from public;

-- The records that are removed with it (the database removes some linked
-- records automatically, e.g. a body's seats with the body), followed down a
-- few levels. Kept with the request, and checked again before removing.
create function private.removal_dependents(p_table text, p_key text, p_ids uuid[], p_depth integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  fk record;
  found_rows jsonb;
  child_ids uuid[];
  result jsonb := '[]'::jsonb;
begin
  if p_depth > 3 or coalesce(array_length(p_ids, 1), 0) = 0 then
    return result;
  end if;
  for fk in
    select distinct cl.relname as child, a.attname as child_col
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class cl on cl.oid = c.conrelid
    join pg_catalog.pg_namespace ns on ns.oid = cl.relnamespace
    join pg_catalog.pg_class pc on pc.oid = c.confrelid
    cross join lateral unnest(c.conkey, c.confkey) as u (ck, pk)
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = u.ck
    join pg_catalog.pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = u.pk
    where c.contype = 'f' and c.confdeltype = 'c' and ns.nspname = 'public' and pc.relname = p_table and pa.attname = p_key
      and cl.relname not in ('audit_log', 'removal_requests')
    order by 1, 2
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t) order by t::text), ''[]''::jsonb) from public.%I t where t.%I = any ($1)', fk.child, fk.child_col)
      into found_rows using p_ids;
    if jsonb_array_length(found_rows) > 0 then
      result := result || jsonb_build_array(jsonb_build_object('table', fk.child, 'rows', found_rows));
      if exists (select 1 from information_schema.columns col where col.table_schema = 'public' and col.table_name = fk.child and col.column_name = 'id') then
        select array_agg((x->>'id')::uuid) into child_ids from jsonb_array_elements(found_rows) x;
        result := result || private.removal_dependents(fk.child, 'id', child_ids, p_depth + 1);
      end if;
    end if;
  end loop;
  return result;
end;
$$;
revoke all on function private.removal_dependents(text, text, uuid[], integer) from public;

-- Some records are kept for good and can't be removed at all.
create function private.removal_allowed(p_table text, p_id uuid, rec jsonb)
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
end;
$$;
revoke all on function private.removal_allowed(text, uuid, jsonb) from public;

-- A readable description, e.g. "Appointment (director): Pieter Visser, Visser Holdings Limited".
create function private.removal_summary(p_table text, r jsonb)
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
  if r ? 'entity_id' and r->>'entity_id' is not null then
    parts := parts || (select e.name from public.entities e where e.id = (r->>'entity_id')::uuid);
  end if;
  return (select label from private.removable(p_table))
    || coalesce(' (' || coalesce(r->>'role', r->>'kind') || ')', '')
    || coalesce(': ' || nullif(array_to_string(parts, ', '), ''), '');
end;
$$;
revoke all on function private.removal_summary(text, jsonb) from public;

-- Ask for a removal. Managers and Administrators may ask.
create function public.request_removal(p_table text, p_id uuid, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec jsonb;
  deps jsonb;
  linked integer;
  new_id uuid;
begin
  if not private.can_edit() or auth.uid() is null then
    raise exception 'Removal: only a Manager or Administrator can ask for a removal.';
  end if;
  rec := private.removal_target(p_table, p_id);
  if rec is null then
    raise exception 'Removal: that record isn''t there any more.';
  end if;
  perform private.removal_allowed(p_table, p_id, rec);
  deps := private.removal_dependents(p_table, (select r.key_column from private.removable(p_table) r), array[p_id]);
  linked := (select coalesce(sum(jsonb_array_length(d->'rows')), 0) from jsonb_array_elements(deps) d);
  if exists (select 1 from public.removal_requests q where q.table_name = p_table and q.record_id = p_id and q.status = 'pending') then
    raise exception 'Removal: the removal of this has already been asked for. A Manager who didn''t ask approves it.';
  end if;
  insert into public.removal_requests (table_name, record_id, summary, snapshot, goes_with, reason, requested_by)
  values (p_table, p_id,
    private.removal_summary(p_table, rec) || case when linked = 0 then '' when linked = 1 then ' (and 1 linked record)' else ' (and ' || linked || ' linked records)' end,
    rec, deps, nullif(trim(p_reason), ''), auth.uid())
  returning id into new_id;
  return new_id;
end;
$$;

-- Approve (and so remove) or reject. Managers and the Super User only; whoever
-- asked can't approve.
create function public.decide_removal(p_request uuid, p_approve boolean, p_note text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.removal_requests;
  rec jsonb;
  k text;
  n integer;
begin
  if not private.can_manage() or auth.uid() is null then
    raise exception 'Removal: only a Manager can approve or reject a removal.';
  end if;
  select * into q from public.removal_requests r where r.id = p_request for update;
  if q.id is null or q.status <> 'pending' then
    raise exception 'Removal: that request has already been dealt with.';
  end if;

  if not p_approve then
    if auth.uid() = q.requested_by then
      raise exception 'Removal: you asked for this removal, so withdraw it instead of turning it down.';
    end if;
    update public.removal_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '')
    where id = q.id;
    return 'rejected';
  end if;

  if auth.uid() = q.requested_by then
    raise exception 'Removal: whoever asked for a removal can''t also approve it. Ask another Manager.';
  end if;
  k := (select r.key_column from private.removable(q.table_name) r);
  -- Hold the record still while it is checked and removed.
  execute format('select to_jsonb(t) from public.%I t where t.%I = $1 for update', q.table_name, k) into rec using q.record_id;
  if rec is not null then
    perform private.removal_allowed(q.table_name, q.record_id, rec);
    -- Only exactly what was asked for is removed: if the record, or what
    -- would go with it, has changed since, nothing is removed.
    if rec is distinct from q.snapshot or private.removal_dependents(q.table_name, k, array[q.record_id]) is distinct from q.goes_with then
      raise exception 'Removal: it has changed since the removal was asked for, so nothing was removed. Turn this request down and ask again if it should still go.';
    end if;
    execute format('delete from public.%I where %I = $1', q.table_name, k) using q.record_id;
    get diagnostics n = row_count;
  end if;
  update public.removal_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(),
    decision_note = coalesce(nullif(trim(p_note), ''), case when coalesce(n, 0) = 0 then 'It had already gone.' end)
  where id = q.id;
  return 'approved';
end;
$$;

-- Whoever asked may withdraw their own request.
create function public.withdraw_removal(p_request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_edit() then
    raise exception 'Removal: you don''t have permission to do that.';
  end if;
  update public.removal_requests set status = 'withdrawn', decided_by = auth.uid(), decided_at = now()
  where id = p_request and status = 'pending' and requested_by = auth.uid();
  if not found then
    raise exception 'Removal: only whoever asked can withdraw a request that is still waiting.';
  end if;
end;
$$;

revoke all on function public.request_removal(text, uuid, text), public.decide_removal(uuid, boolean, text), public.withdraw_removal(uuid) from public, anon;
grant execute on function public.request_removal(text, uuid, text), public.decide_removal(uuid, boolean, text), public.withdraw_removal(uuid) to authenticated;

-- Starting a branch (the branch and its head, together): before, a failure
-- half way was put right by removing the new branch, which one person can no
-- longer do. Now both steps happen at once, or neither does.
create function public.start_branch(p_person uuid, p_name text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  b uuid;
begin
  insert into public.branches (name, head_person_id) values (p_name, p_person) returning id into b;
  update public.people set branch_id = b where id = p_person;
  if not found then
    raise exception 'Family link: that person couldn''t be found.';
  end if;
  return b;
end;
$$;
revoke all on function public.start_branch(uuid, text) from public, anon;
grant execute on function public.start_branch(uuid, text) to authenticated;

-- No direct removals any more (except a Viewer's access, see above).
do $$
declare
  pol record;
begin
  for pol in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and cmd = 'DELETE' and tablename not in ('access_grants', 'audit_log')
  loop
    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end;
$$;
