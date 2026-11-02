-- Turnstone Village Square: filings and deadlines in the Entity Standards (hub)
--
-- Each Entity Standard lists its obligations: the filings that recur (an
-- annual return, accounts, a tax return, an annual fee) and the notices due
-- after an event (a director appointed or leaving, a change of members or
-- of beneficial owners). Each says how its due date is worked out:
--   anniversary  – after each anniversary of the date of registration
--   year_end     – after each financial year end
--   fixed_date   – on the same date every year
--   half_year    – one date if registered January–June, another if July–December
--   event        – after the event
-- plus months, days (calendar or business days). Families' calendars are
-- worked out from these. The key (e.g. "annual_return") stays the same
-- across versions, so what a family has marked as filed is kept.
--
-- Like the rest of a standard, obligations are changed only by the Super User
-- or System Admin, and only while the standard is a draft; a new version
-- starts with a copy of the obligations of the version it is based on.

create table public.standard_obligations (
  id uuid primary key default gen_random_uuid(),
  standard_id uuid not null references public.entity_standards (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]{2,60}$'),
  name text not null check (length(trim(name)) > 0),
  authority text,
  kind text not null check (kind in ('recurring', 'event')),
  basis text check (basis in ('anniversary', 'year_end', 'fixed_date', 'half_year')),
  offset_months integer not null default 0 check (offset_months between 0 and 36),
  offset_days integer not null default 0 check (offset_days between 0 and 365),
  business_days boolean not null default false,
  fixed_month integer check (fixed_month between 1 and 12),
  fixed_day integer check (fixed_day between 1 and 31),
  alt_month integer check (alt_month between 1 and 12),
  alt_day integer check (alt_day between 1 and 31),
  event_type text check (event_type in ('officer_change', 'member_change', 'share_issue', 'bo_change')),
  event_roles text[],
  to_confirm boolean not null default false,
  notes text,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  unique (standard_id, key),
  check ((kind = 'recurring') = (basis is not null)),
  check ((kind = 'event') = (event_type is not null)),
  check (basis not in ('fixed_date', 'half_year') or (fixed_month is not null and fixed_day is not null)),
  check (basis is distinct from 'half_year' or (alt_month is not null and alt_day is not null))
);
create index standard_obligations_standard on public.standard_obligations (standard_id);

-- Only while the standard is a draft (set-up scripts aside).
create function private.obligation_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  st text;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  select s.status into st from public.entity_standards s where s.id = coalesce(new.standard_id, old.standard_id);
  if st is distinct from 'draft' or (tg_op = 'UPDATE' and new.standard_id <> old.standard_id) then
    raise exception 'Entity Standard: obligations can only be changed on a draft. Change the standard first: that makes a new draft version.';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function private.obligation_rules() from public;
create trigger standard_obligations_rules before insert or update or delete on public.standard_obligations
  for each row execute function private.obligation_rules();

-- A new version (or a draft copied from the closest standard) starts with
-- the obligations of the standard it is based on.
create function private.copy_obligations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.based_on is not null then
    insert into public.standard_obligations (standard_id, key, name, authority, kind, basis, offset_months, offset_days, business_days,
      fixed_month, fixed_day, alt_month, alt_day, event_type, event_roles, to_confirm, notes, sort)
    select new.id, o.key, o.name, o.authority, o.kind, o.basis, o.offset_months, o.offset_days, o.business_days,
      o.fixed_month, o.fixed_day, o.alt_month, o.alt_day, o.event_type, o.event_roles,
      o.to_confirm or (new.status = 'draft' and new.sub_type is distinct from (select b.sub_type from public.entity_standards b where b.id = new.based_on)),
      o.notes, o.sort
    from public.standard_obligations o where o.standard_id = new.based_on
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.copy_obligations() from public;
create trigger entity_standards_copy_obligations after insert on public.entity_standards
  for each row execute function private.copy_obligations();

alter table public.standard_obligations enable row level security;
create policy "standard_obligations: anyone signed in reads" on public.standard_obligations
  for select to authenticated using (true);
create policy "standard_obligations: super user and system admin add" on public.standard_obligations
  for insert to authenticated with check (private.can_approve_standard());
create policy "standard_obligations: super user and system admin change" on public.standard_obligations
  for update to authenticated using (private.can_approve_standard()) with check (private.can_approve_standard());
create policy "standard_obligations: super user and system admin remove from a draft" on public.standard_obligations
  for delete to authenticated using (private.can_approve_standard());
create trigger standard_obligations_log after insert or update or delete on public.standard_obligations
  for each row execute function private.log_change();
revoke all on public.standard_obligations from anon;

-- The starting obligations, for every current version of the starting
-- standards. Items marked to_confirm are shown as "to confirm".
insert into public.standard_obligations (standard_id, key, name, authority, kind, basis, offset_months, offset_days, business_days,
  fixed_month, fixed_day, alt_month, alt_day, event_type, event_roles, to_confirm, notes, sort)
select s.id, v.key, v.name, v.authority, v.kind, v.basis, v.months, v.days, v.business, v.fm, v.fd, v.am, v.ad, v.event, v.roles, v.tc, v.notes, v.sort
from (values
  ('South Africa', 'Private company (Pty) Ltd', 'annual_return', 'Annual return', 'CIPC', 'recurring', 'anniversary', 0, 30, true, null, null, null, null, null, null, true, 'Within 30 business days after the anniversary of incorporation.', 0),
  ('South Africa', 'Private company (Pty) Ltd', 'bo_declaration', 'Beneficial ownership declaration', 'CIPC', 'recurring', 'anniversary', 0, 30, true, null, null, null, null, null, null, true, 'Filed with the annual return, in the same calendar year.', 1),
  ('South Africa', 'Private company (Pty) Ltd', 'financial_statements', 'Annual financial statements', 'Company records', 'recurring', 'year_end', 6, 0, false, null, null, null, null, null, null, false, 'Audit or independent review, depending on the public interest score.', 2),
  ('South Africa', 'Private company (Pty) Ltd', 'income_tax_return', 'Income tax return (ITR14)', 'SARS', 'recurring', 'year_end', 12, 0, false, null, null, null, null, null, null, false, null, 3),
  ('South Africa', 'Private company (Pty) Ltd', 'director_change', 'Director change (CoR39)', 'CIPC', 'event', null, 0, 10, true, null, null, null, null, 'officer_change', array['director', 'alternate_director']::text[], true, null, 4),
  ('South Africa', 'Private company (Pty) Ltd', 'bo_change', 'Beneficial ownership change', 'CIPC', 'event', null, 0, 10, true, null, null, null, null, 'bo_change', null, true, 'Report changes when they occur; 10 business days is a working default.', 5),
  ('South Africa', 'Public company Ltd', 'annual_return', 'Annual return', 'CIPC', 'recurring', 'anniversary', 0, 30, true, null, null, null, null, null, null, true, 'Within 30 business days after the anniversary of incorporation.', 6),
  ('South Africa', 'Public company Ltd', 'bo_declaration', 'Beneficial ownership declaration', 'CIPC', 'recurring', 'anniversary', 0, 30, true, null, null, null, null, null, null, true, 'Filed with the annual return, in the same calendar year.', 7),
  ('South Africa', 'Public company Ltd', 'financial_statements', 'Annual financial statements', 'Company records', 'recurring', 'year_end', 6, 0, false, null, null, null, null, null, null, false, 'Audit or independent review, depending on the public interest score.', 8),
  ('South Africa', 'Public company Ltd', 'income_tax_return', 'Income tax return (ITR14)', 'SARS', 'recurring', 'year_end', 12, 0, false, null, null, null, null, null, null, false, null, 9),
  ('South Africa', 'Public company Ltd', 'director_change', 'Director change (CoR39)', 'CIPC', 'event', null, 0, 10, true, null, null, null, null, 'officer_change', array['director', 'alternate_director']::text[], true, null, 10),
  ('South Africa', 'Public company Ltd', 'bo_change', 'Beneficial ownership change', 'CIPC', 'event', null, 0, 10, true, null, null, null, null, 'bo_change', null, true, 'Report changes when they occur; 10 business days is a working default.', 11),
  ('South Africa', 'Personal liability company Inc', 'annual_return', 'Annual return', 'CIPC', 'recurring', 'anniversary', 0, 30, true, null, null, null, null, null, null, true, 'Within 30 business days after the anniversary of incorporation.', 12),
  ('South Africa', 'Personal liability company Inc', 'bo_declaration', 'Beneficial ownership declaration', 'CIPC', 'recurring', 'anniversary', 0, 30, true, null, null, null, null, null, null, true, 'Filed with the annual return, in the same calendar year.', 13),
  ('South Africa', 'Personal liability company Inc', 'financial_statements', 'Annual financial statements', 'Company records', 'recurring', 'year_end', 6, 0, false, null, null, null, null, null, null, false, 'Audit or independent review, depending on the public interest score.', 14),
  ('South Africa', 'Personal liability company Inc', 'income_tax_return', 'Income tax return (ITR14)', 'SARS', 'recurring', 'year_end', 12, 0, false, null, null, null, null, null, null, false, null, 15),
  ('South Africa', 'Personal liability company Inc', 'director_change', 'Director change (CoR39)', 'CIPC', 'event', null, 0, 10, true, null, null, null, null, 'officer_change', array['director', 'alternate_director']::text[], true, null, 16),
  ('South Africa', 'Personal liability company Inc', 'bo_change', 'Beneficial ownership change', 'CIPC', 'event', null, 0, 10, true, null, null, null, null, 'bo_change', null, true, 'Report changes when they occur; 10 business days is a working default.', 17),
  ('South Africa', 'Non-profit company NPC', 'annual_return', 'Annual return', 'CIPC', 'recurring', 'anniversary', 0, 30, true, null, null, null, null, null, null, true, 'Within 30 business days after the anniversary of incorporation.', 18),
  ('South Africa', 'Non-profit company NPC', 'bo_declaration', 'Beneficial ownership declaration', 'CIPC', 'recurring', 'anniversary', 0, 30, true, null, null, null, null, null, null, true, 'Filed with the annual return, in the same calendar year.', 19),
  ('South Africa', 'Non-profit company NPC', 'financial_statements', 'Annual financial statements', 'Company records', 'recurring', 'year_end', 6, 0, false, null, null, null, null, null, null, false, 'Audit or independent review, depending on the public interest score.', 20),
  ('South Africa', 'Non-profit company NPC', 'income_tax_return', 'Income tax return (ITR14)', 'SARS', 'recurring', 'year_end', 12, 0, false, null, null, null, null, null, null, false, null, 21),
  ('South Africa', 'Non-profit company NPC', 'director_change', 'Director change (CoR39)', 'CIPC', 'event', null, 0, 10, true, null, null, null, null, 'officer_change', array['director', 'alternate_director']::text[], true, null, 22),
  ('South Africa', 'Non-profit company NPC', 'bo_change', 'Beneficial ownership change', 'CIPC', 'event', null, 0, 10, true, null, null, null, null, 'bo_change', null, true, 'Report changes when they occur; 10 business days is a working default.', 23),
  ('South Africa', 'Close corporation CC', 'financial_statements', 'Annual financial statements with the accounting officer''s report', 'Company records', 'recurring', 'year_end', 9, 0, false, null, null, null, null, null, null, false, null, 24),
  ('South Africa', 'Close corporation CC', 'annual_return', 'Annual return', 'CIPC', 'recurring', 'anniversary', 0, 30, true, null, null, null, null, null, null, true, null, 25),
  ('South Africa', 'Close corporation CC', 'bo_declaration', 'Beneficial ownership declaration', 'CIPC', 'recurring', 'anniversary', 0, 30, true, null, null, null, null, null, null, true, null, 26),
  ('South Africa', 'Close corporation CC', 'income_tax_return', 'Income tax return (ITR14)', 'SARS', 'recurring', 'year_end', 12, 0, false, null, null, null, null, null, null, false, null, 27),
  ('South Africa', 'Close corporation CC', 'member_change', 'Amended founding statement (CK2)', 'CIPC', 'event', null, 0, 28, false, null, null, null, null, 'officer_change', array['member']::text[], false, null, 28),
  ('South Africa', 'Inter vivos trust', 'trust_tax_return', 'Trust income tax return (ITR12T)', 'SARS', 'recurring', 'fixed_date', 0, 0, false, 1, 22, null, null, null, null, true, 'The closing date is set by SARS each season.', 29),
  ('South Africa', 'Inter vivos trust', 'it3t', 'IT3(t) third-party data return', 'SARS', 'recurring', 'fixed_date', 0, 0, false, 9, 30, null, null, null, null, false, null, 30),
  ('South Africa', 'Inter vivos trust', 'trustee_change', 'Trustee change: amended Letters of Authority', 'Master of the High Court', 'event', null, 0, 0, false, null, null, null, null, 'officer_change', array['trustee']::text[], true, null, 31),
  ('South Africa', 'Inter vivos trust', 'bo_change', 'Trust beneficial ownership register update', 'Master of the High Court', 'event', null, 0, 0, false, null, null, null, null, 'bo_change', null, true, 'Update as changes occur.', 32),
  ('Isle of Man', '1931 Act company', 'annual_return', 'Annual return (with the BO compliance statement)', 'Companies Registry', 'recurring', 'anniversary', 1, 0, false, null, null, null, null, null, null, false, null, 33),
  ('Isle of Man', '1931 Act company', 'company_tax_return', 'Company tax return (R1C)', 'Income Tax Division', 'recurring', 'year_end', 12, 1, false, null, null, null, null, null, null, false, null, 34),
  ('Isle of Man', '1931 Act company', 'officer_change', 'Director or secretary change (Form 9N)', 'Companies Registry', 'event', null, 1, 0, false, null, null, null, null, 'officer_change', array['director', 'alternate_director', 'secretary']::text[], false, null, 35),
  ('Isle of Man', '1931 Act company', 'nominated_officer_change', 'Nominated officer change', 'Companies Registry', 'event', null, 0, 21, false, null, null, null, null, 'officer_change', array['nominated_officer']::text[], false, null, 36),
  ('Isle of Man', '1931 Act company', 'bo_change', 'Beneficial ownership change', 'BO database', 'event', null, 0, 21, false, null, null, null, null, 'bo_change', null, false, null, 37),
  ('Isle of Man', '2006 Act company', 'annual_return', 'Annual return (IMAR, with the BO statement)', 'Companies Registry', 'recurring', 'anniversary', 1, 0, false, null, null, null, null, null, null, false, null, 38),
  ('Isle of Man', '2006 Act company', 'company_tax_return', 'Company tax return (R1C)', 'Income Tax Division', 'recurring', 'year_end', 12, 1, false, null, null, null, null, null, null, false, null, 39),
  ('Isle of Man', '2006 Act company', 'director_change', 'Director change', 'Companies Registry', 'event', null, 1, 0, false, null, null, null, null, 'officer_change', array['director', 'alternate_director']::text[], true, null, 40),
  ('Isle of Man', '2006 Act company', 'agent_change', 'Registered agent change', 'Companies Registry', 'event', null, 1, 0, false, null, null, null, null, 'officer_change', array['registered_agent']::text[], true, null, 41),
  ('Isle of Man', '2006 Act company', 'nominated_officer_change', 'Nominated officer change', 'Companies Registry', 'event', null, 0, 21, false, null, null, null, null, 'officer_change', array['nominated_officer']::text[], false, null, 42),
  ('Isle of Man', '2006 Act company', 'bo_change', 'Beneficial ownership change', 'BO database', 'event', null, 0, 21, false, null, null, null, null, 'bo_change', null, false, null, 43),
  ('Isle of Man', 'Limited liability company', 'annual_return', 'Annual return (L10)', 'Companies Registry', 'recurring', 'anniversary', 1, 0, false, null, null, null, null, null, null, true, null, 44),
  ('Isle of Man', 'Limited liability company', 'agent_change', 'Registered agent change (L5)', 'Companies Registry', 'event', null, 1, 0, false, null, null, null, null, 'officer_change', array['registered_agent']::text[], true, null, 45),
  ('Isle of Man', 'Foundation', 'annual_return', 'Annual return (MFAR)', 'Companies Registry', 'recurring', 'anniversary', 1, 0, false, null, null, null, null, null, null, true, null, 46),
  ('Isle of Man', 'Foundation', 'company_tax_return', 'Tax return (R1C)', 'Income Tax Division', 'recurring', 'year_end', 12, 1, false, null, null, null, null, null, null, false, null, 47),
  ('Isle of Man', 'Foundation', 'council_change', 'Council change', 'Companies Registry', 'event', null, 1, 0, false, null, null, null, null, 'officer_change', array['council_member']::text[], false, null, 48),
  ('Isle of Man', 'Foundation', 'bo_change', 'Beneficial ownership change', 'BO database', 'event', null, 0, 21, false, null, null, null, null, 'bo_change', null, true, null, 49),
  ('United Kingdom', 'Private company limited by shares', 'confirmation_statement', 'Confirmation statement', 'Companies House', 'recurring', 'anniversary', 0, 14, false, null, null, null, null, null, null, false, 'Within 14 days after the review period ends. Directors must be identity-verified first.', 50),
  ('United Kingdom', 'Private company limited by shares', 'corporation_tax_return', 'Corporation tax return (CT600)', 'HMRC', 'recurring', 'year_end', 12, 0, false, null, null, null, null, null, null, false, null, 51),
  ('United Kingdom', 'Private company limited by shares', 'corporation_tax_payment', 'Corporation tax payment', 'HMRC', 'recurring', 'year_end', 9, 1, false, null, null, null, null, null, null, false, null, 52),
  ('United Kingdom', 'Private company limited by shares', 'officer_change', 'Director or secretary change', 'Companies House', 'event', null, 0, 14, false, null, null, null, null, 'officer_change', array['director', 'alternate_director', 'secretary']::text[], false, null, 53),
  ('United Kingdom', 'Private company limited by shares', 'psc_change', 'PSC (beneficial ownership) change', 'Companies House', 'event', null, 0, 14, false, null, null, null, null, 'bo_change', null, false, null, 54),
  ('United Kingdom', 'Private company limited by shares', 'share_allotment', 'Return of allotment of shares (SH01)', 'Companies House', 'event', null, 1, 0, false, null, null, null, null, 'share_issue', null, false, null, 55),
  ('United Kingdom', 'Public limited company plc', 'confirmation_statement', 'Confirmation statement', 'Companies House', 'recurring', 'anniversary', 0, 14, false, null, null, null, null, null, null, false, 'Within 14 days after the review period ends. Directors must be identity-verified first.', 56),
  ('United Kingdom', 'Public limited company plc', 'corporation_tax_return', 'Corporation tax return (CT600)', 'HMRC', 'recurring', 'year_end', 12, 0, false, null, null, null, null, null, null, false, null, 57),
  ('United Kingdom', 'Public limited company plc', 'corporation_tax_payment', 'Corporation tax payment', 'HMRC', 'recurring', 'year_end', 9, 1, false, null, null, null, null, null, null, false, null, 58),
  ('United Kingdom', 'Public limited company plc', 'officer_change', 'Director or secretary change', 'Companies House', 'event', null, 0, 14, false, null, null, null, null, 'officer_change', array['director', 'alternate_director', 'secretary']::text[], false, null, 59),
  ('United Kingdom', 'Public limited company plc', 'psc_change', 'PSC (beneficial ownership) change', 'Companies House', 'event', null, 0, 14, false, null, null, null, null, 'bo_change', null, false, null, 60),
  ('United Kingdom', 'Public limited company plc', 'share_allotment', 'Return of allotment of shares (SH01)', 'Companies House', 'event', null, 1, 0, false, null, null, null, null, 'share_issue', null, false, null, 61),
  ('United Kingdom', 'Private company limited by shares', 'accounts', 'Annual accounts', 'Companies House', 'recurring', 'year_end', 9, 0, false, null, null, null, null, null, null, false, 'First accounts: 21 months after incorporation.', 62),
  ('United Kingdom', 'Public limited company plc', 'accounts', 'Annual accounts', 'Companies House', 'recurring', 'year_end', 6, 0, false, null, null, null, null, null, null, false, null, 63),
  ('United Kingdom', 'Public limited company plc', 'agm', 'Annual general meeting', 'Company', 'recurring', 'year_end', 6, 0, false, null, null, null, null, null, null, false, null, 64),
  ('United Kingdom', 'Limited liability partnership LLP', 'confirmation_statement', 'Confirmation statement', 'Companies House', 'recurring', 'anniversary', 0, 14, false, null, null, null, null, null, null, false, null, 65),
  ('United Kingdom', 'Limited liability partnership LLP', 'accounts', 'Annual accounts', 'Companies House', 'recurring', 'year_end', 9, 0, false, null, null, null, null, null, null, false, null, 66),
  ('United Kingdom', 'Limited liability partnership LLP', 'member_change', 'Member change', 'Companies House', 'event', null, 0, 14, false, null, null, null, null, 'officer_change', array['member', 'designated_member']::text[], false, null, 67),
  ('United Kingdom', 'Limited liability partnership LLP', 'psc_change', 'PSC change', 'Companies House', 'event', null, 0, 14, false, null, null, null, null, 'bo_change', null, false, null, 68),
  ('United Kingdom', 'Express trust', 'trs_confirmation', 'Trust Registration Service: confirm the record is up to date', 'HMRC', 'recurring', 'fixed_date', 0, 0, false, 1, 31, null, null, null, null, false, 'For taxable trusts.', 69),
  ('United Kingdom', 'Express trust', 'trust_tax_return', 'Trust tax return (SA900, online)', 'HMRC', 'recurring', 'fixed_date', 0, 0, false, 1, 31, null, null, null, null, false, null, 70),
  ('United Kingdom', 'Express trust', 'trs_change', 'Trust Registration Service change', 'HMRC', 'event', null, 0, 90, false, null, null, null, null, 'bo_change', null, false, null, 71),
  ('British Virgin Islands', 'BVI Business Company', 'annual_fee', 'Annual fee', 'Registry of Corporate Affairs', 'recurring', 'half_year', 0, 0, false, 5, 31, 11, 30, null, null, true, '31 May if incorporated January–June; 30 November if July–December.', 72),
  ('British Virgin Islands', 'BVI Business Company', 'financial_return', 'Annual financial return to the registered agent', 'Registered agent', 'recurring', 'year_end', 9, 0, false, null, null, null, null, null, null, false, null, 73),
  ('British Virgin Islands', 'BVI Business Company', 'economic_substance', 'Economic substance report (VIRRGIN)', 'International Tax Authority', 'recurring', 'year_end', 6, 0, false, null, null, null, null, null, null, true, null, 74),
  ('British Virgin Islands', 'BVI Business Company', 'members_change', 'Register of members: file the change', 'Registry of Corporate Affairs', 'event', null, 0, 30, false, null, null, null, null, 'member_change', null, false, null, 75),
  ('British Virgin Islands', 'BVI Business Company', 'director_change', 'Register of directors: file the change', 'Registry of Corporate Affairs', 'event', null, 0, 30, false, null, null, null, null, 'officer_change', array['director', 'alternate_director']::text[], true, null, 76),
  ('British Virgin Islands', 'BVI Business Company', 'bo_change', 'Beneficial ownership change (VIRRGIN)', 'Registered agent', 'event', null, 0, 30, false, null, null, null, null, 'bo_change', null, false, null, 77),
  ('British Virgin Islands', 'Limited partnership', 'annual_fee', 'Annual fee', 'Registry of Corporate Affairs', 'recurring', 'half_year', 0, 0, false, 5, 31, 11, 30, null, null, true, null, 78),
  ('British Virgin Islands', 'Limited partnership', 'financial_return', 'Annual financial return to the registered agent', 'Registered agent', 'recurring', 'year_end', 9, 0, false, null, null, null, null, null, null, false, null, 79),
  ('British Virgin Islands', 'Limited partnership', 'economic_substance', 'Economic substance report', 'International Tax Authority', 'recurring', 'year_end', 6, 0, false, null, null, null, null, null, null, true, null, 80),
  ('British Virgin Islands', 'Limited partnership', 'partner_change', 'Register of partners: file the change', 'Registry of Corporate Affairs', 'event', null, 0, 30, false, null, null, null, null, 'officer_change', array['general_partner', 'limited_partner']::text[], false, null, 81),
  ('British Virgin Islands', 'Limited partnership', 'bo_change', 'Beneficial ownership change', 'Registered agent', 'event', null, 0, 30, false, null, null, null, null, 'bo_change', null, false, null, 82),
  ('Mauritius', 'Domestic private company', 'registrar_fee', 'Annual Registrar fee', 'Registrar of Companies', 'recurring', 'fixed_date', 0, 0, false, 1, 20, null, null, null, null, false, 'Payable 3–20 January.', 83),
  ('Mauritius', 'Domestic private company', 'officer_change', 'Director or secretary change', 'Registrar of Companies', 'event', null, 0, 28, false, null, null, null, null, 'officer_change', array['director', 'alternate_director', 'secretary']::text[], false, null, 84),
  ('Mauritius', 'Domestic private company', 'bo_change', 'Beneficial ownership change', 'Registrar of Companies', 'event', null, 0, 14, false, null, null, null, null, 'bo_change', null, false, null, 85),
  ('Mauritius', 'Domestic private company', 'share_issue', 'Share issue', 'Registrar of Companies', 'event', null, 0, 14, false, null, null, null, null, 'share_issue', null, false, null, 86),
  ('Mauritius', 'Global Business Licence company', 'registrar_fee', 'Annual Registrar fee', 'Registrar of Companies', 'recurring', 'fixed_date', 0, 0, false, 1, 20, null, null, null, null, false, 'Payable 3–20 January.', 87),
  ('Mauritius', 'Global Business Licence company', 'officer_change', 'Director or secretary change', 'Registrar of Companies', 'event', null, 0, 28, false, null, null, null, null, 'officer_change', array['director', 'alternate_director', 'secretary']::text[], false, null, 88),
  ('Mauritius', 'Global Business Licence company', 'bo_change', 'Beneficial ownership change', 'Registrar of Companies', 'event', null, 0, 14, false, null, null, null, null, 'bo_change', null, false, null, 89),
  ('Mauritius', 'Global Business Licence company', 'share_issue', 'Share issue', 'Registrar of Companies', 'event', null, 0, 14, false, null, null, null, null, 'share_issue', null, false, null, 90),
  ('Mauritius', 'Authorised Company', 'registrar_fee', 'Annual Registrar fee', 'Registrar of Companies', 'recurring', 'fixed_date', 0, 0, false, 1, 20, null, null, null, null, false, 'Payable 3–20 January.', 91),
  ('Mauritius', 'Authorised Company', 'officer_change', 'Director or secretary change', 'Registrar of Companies', 'event', null, 0, 28, false, null, null, null, null, 'officer_change', array['director', 'alternate_director', 'secretary']::text[], false, null, 92),
  ('Mauritius', 'Authorised Company', 'bo_change', 'Beneficial ownership change', 'Registrar of Companies', 'event', null, 0, 14, false, null, null, null, null, 'bo_change', null, false, null, 93),
  ('Mauritius', 'Authorised Company', 'share_issue', 'Share issue', 'Registrar of Companies', 'event', null, 0, 14, false, null, null, null, null, 'share_issue', null, false, null, 94),
  ('Mauritius', 'Domestic private company', 'annual_meeting', 'Annual meeting', 'Company', 'recurring', 'year_end', 6, 0, false, null, null, null, null, null, null, false, null, 95),
  ('Mauritius', 'Domestic private company', 'annual_return', 'Annual return (with updated BO)', 'Registrar of Companies', 'recurring', 'year_end', 6, 28, false, null, null, null, null, null, null, false, 'Within 28 days of the annual meeting.', 96),
  ('Mauritius', 'Domestic private company', 'financial_statements', 'Financial statements', 'Registrar of Companies', 'recurring', 'year_end', 6, 0, false, null, null, null, null, null, null, false, null, 97),
  ('Mauritius', 'Domestic private company', 'income_tax_return', 'Income tax return', 'MRA', 'recurring', 'year_end', 6, 0, false, null, null, null, null, null, null, false, null, 98),
  ('Mauritius', 'Global Business Licence company', 'annual_meeting', 'Annual meeting', 'Company', 'recurring', 'year_end', 6, 0, false, null, null, null, null, null, null, false, null, 99),
  ('Mauritius', 'Global Business Licence company', 'annual_return', 'Annual return (with updated BO)', 'Registrar of Companies', 'recurring', 'year_end', 6, 28, false, null, null, null, null, null, null, false, 'Within 28 days of the annual meeting.', 100),
  ('Mauritius', 'Global Business Licence company', 'financial_statements', 'Financial statements', 'Registrar of Companies', 'recurring', 'year_end', 6, 0, false, null, null, null, null, null, null, false, null, 101),
  ('Mauritius', 'Global Business Licence company', 'income_tax_return', 'Income tax return', 'MRA', 'recurring', 'year_end', 6, 0, false, null, null, null, null, null, null, false, null, 102),
  ('Mauritius', 'Global Business Licence company', 'fsc_accounts', 'Audited IFRS financial statements to the FSC', 'FSC', 'recurring', 'year_end', 6, 0, false, null, null, null, null, null, null, false, null, 103),
  ('Mauritius', 'Authorised Company', 'income_tax_return', 'Income tax return', 'MRA', 'recurring', 'year_end', 6, 0, false, null, null, null, null, null, null, true, null, 104),
  ('Mauritius', 'Foundation', 'annual_fee', 'Annual fee', 'Registrar of Foundations', 'recurring', 'fixed_date', 0, 0, false, 1, 20, null, null, null, null, false, null, 105),
  ('Mauritius', 'Foundation', 'council_change', 'Council change', 'Registrar of Foundations', 'event', null, 0, 7, false, null, null, null, null, 'officer_change', array['council_member']::text[], false, null, 106),
  ('Mauritius', 'Foundation', 'bo_change', 'Beneficial ownership change', 'Registrar of Foundations', 'event', null, 0, 14, false, null, null, null, null, 'bo_change', null, false, null, 107)
) as v (jurisdiction, sub_type, key, name, authority, kind, basis, months, days, business, fm, fd, am, ad, event, roles, tc, notes, sort)
join public.entity_standards s on lower(s.jurisdiction) = lower(v.jurisdiction) and lower(s.sub_type) = lower(v.sub_type) and s.status <> 'retired'
on conflict (standard_id, key) do nothing;
