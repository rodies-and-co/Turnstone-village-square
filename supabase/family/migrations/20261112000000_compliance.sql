-- Turnstone Village Square: compliance (family database)
--
-- What has been done about each filing or notice in an entity's compliance
-- calendar. The calendar itself is worked out from the obligations in the
-- entity's Entity Standard (kept in the hub); only what the family records
-- about it is kept here: filed (with the date and a reference) or not
-- applicable (with a note). A recurring filing is identified by its
-- obligation and due date; a notice after an event by its obligation and the
-- event (e.g. "appt:<id>:start" for an appointment).

create table public.compliance_filings (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  obligation_key text not null check (obligation_key ~ '^[a-z0-9_]{2,60}$'),
  obligation_name text not null, -- as it was named when recorded
  due_date date not null,
  event_key text,
  status text not null check (status in ('filed', 'not_applicable')),
  done_on date,
  reference text,
  notes text,
  recorded_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'filed' or done_on is not null)
);
create unique index compliance_filings_one on public.compliance_filings (entity_id, obligation_key, due_date, coalesce(event_key, ''));
create index compliance_filings_entity on public.compliance_filings (entity_id);

alter table public.compliance_filings enable row level security;
create policy "compliance_filings: read" on public.compliance_filings
  for select to authenticated using (private.can_see_entity_id(entity_id));
create policy "compliance_filings: editors add" on public.compliance_filings
  for insert to authenticated with check (private.can_edit());
create policy "compliance_filings: editors change" on public.compliance_filings
  for update to authenticated using (private.can_edit()) with check (private.can_edit());
-- No delete rule: a record is removed only by two people (removal requests).
create trigger compliance_filings_log after insert or update or delete on public.compliance_filings
  for each row execute function private.log_change();
create trigger compliance_filings_updated_at before update on public.compliance_filings
  for each row execute function private.touch_updated_at();
revoke all on public.compliance_filings from anon;

-- Filing records can be removed (by two people) like everything else.
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
    ('compliance_filings', 'Filing record', 'id')
  ) as v (table_name, label, key_column)
  where v.table_name = p_table;
$$;
revoke all on function private.removable(text) from public;
