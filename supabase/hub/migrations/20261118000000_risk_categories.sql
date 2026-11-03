-- Risk categories, shared by every family's risk register. They start as
-- the UHNW Institute's ten domains of family wealth (to confirm), each with
-- subcategories. Only the Super User and System Admin change them; a
-- category is retired, never deleted, so risks filed under it keep it.
-- The hub holds no family records: risks themselves live in each family's
-- own database and only refer to a category by its key.

create table public.risk_categories (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name text not null check (length(trim(name)) > 0),
  description text,
  subcategories text[] not null default '{}',
  sort integer not null default 100,
  active boolean not null default true,
  to_confirm boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function private.risk_category_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.key <> old.key then
    raise exception 'Risk categories: a category''s key can''t change. Retire it and add a new one.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger risk_categories_rules before insert or update on public.risk_categories
  for each row execute function private.risk_category_rules();
revoke all on function private.risk_category_rules() from public;

alter table public.risk_categories enable row level security;
create policy "risk_categories: anyone signed in reads" on public.risk_categories
  for select to authenticated using (true);
create policy "risk_categories: super user and system admin add" on public.risk_categories
  for insert to authenticated with check (private.can_approve_standard());
create policy "risk_categories: super user and system admin change" on public.risk_categories
  for update to authenticated using (private.can_approve_standard()) with check (private.can_approve_standard());
-- No delete policy: categories are retired, never deleted.

create trigger risk_categories_log after insert or update or delete on public.risk_categories
  for each row execute function private.log_change();
revoke all on public.risk_categories from anon;

-- The starting list. Names and subcategories are to be confirmed against
-- the UHNW Institute's published domains before use with families.
insert into public.risk_categories (key, name, description, subcategories, sort, to_confirm) values
  ('governance', 'Family governance', 'How the family makes decisions together and holds itself to account.',
    array['Family Constitution', 'Decision-making', 'Family meetings', 'Roles and responsibilities', 'Conflict resolution'], 10, true),
  ('relationships', 'Family relationships and communication', 'Trust, communication and how the family handles differences.',
    array['Communication', 'Trust', 'Conflict between members', 'New members (marriage, partners)', 'Branch relations'], 20, true),
  ('rising_generation', 'Family learning and the rising generation', 'Preparing each generation for ownership, leadership and their own lives.',
    array['Education and readiness', 'Next-generation leadership', 'Wellbeing', 'Employment in the family business'], 30, true),
  ('succession', 'Succession and wealth transfer', 'Passing on ownership, leadership and responsibility.',
    array['Leadership succession', 'Ownership transfer', 'Wills and estate planning', 'Incapacity planning', 'Key person'], 40, true),
  ('legal', 'Legal, structures and compliance', 'The family''s entities, agreements and regulatory obligations.',
    array['Entity structure', 'Trusts and foundations', 'Agreements and contracts', 'Regulatory filings', 'Beneficial ownership reporting'], 50, true),
  ('tax', 'Tax', 'Tax residence, reporting and cross-border tax.',
    array['Tax residence', 'Reporting and returns', 'Cross-border tax', 'Estate and inheritance tax'], 60, true),
  ('investments', 'Investments and assets', 'The family''s portfolios, properties and businesses.',
    array['Concentration', 'Liquidity', 'Property', 'Family business', 'Currency'], 70, true),
  ('protection', 'Insurance, security and asset protection', 'Protecting people and assets.',
    array['Insurance cover', 'Creditor and claim protection', 'Cyber security', 'Physical and travel security', 'Reputation'], 80, true),
  ('philanthropy', 'Philanthropy, purpose and values', 'The family''s purpose, values and giving.',
    array['Purpose and values', 'Giving and foundations', 'Social impact'], 90, true),
  ('administration', 'Family office and administration', 'Records, service providers, banking and day-to-day running.',
    array['Records and documents', 'Service providers', 'Banking and payments', 'Key staff', 'Data protection'], 100, true);
