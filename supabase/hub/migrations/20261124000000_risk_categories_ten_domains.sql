-- The risk categories follow the ten domains of family wealth (UHNW
-- Institute), the same list as Circles of advisors (owner, 5 Nov 2026: "the
-- risk categories were supposed to be based on the 10 domains").
--
-- Categories are never deleted: the earlier ones are retired, and the two
-- that keep their key (governance, philanthropy) are renamed. Each family's
-- risks are moved to the new categories by the family script
-- 20261124000000_risk_categories_ten_domains.sql.

update public.risk_categories set active = false
where key in ('relationships', 'rising_generation', 'succession', 'legal', 'tax', 'investments', 'protection', 'administration');

update public.risk_categories set
  name = 'Governance and decision-making', description = 'How the family and its entities decide, and who decides what.',
  subcategories = array['Family Constitution', 'Decision-making', 'Family meetings', 'Roles and responsibilities', 'Entity governance', 'Regulatory compliance'],
  sort = 60, active = true, to_confirm = false
where key = 'governance';
update public.risk_categories set
  name = 'Philanthropy and impact', description = 'The family''s giving, its foundation and the impact it seeks.',
  subcategories = array['Purpose and values', 'Giving and foundations', 'Social impact', 'Reputation'],
  sort = 40, active = true, to_confirm = false
where key = 'philanthropy';

insert into public.risk_categories (key, name, description, subcategories, sort, to_confirm) values
  ('financial', 'Financial management', 'Budgeting, reporting, tax and the family''s financial administration.',
    array['Budgeting and reporting', 'Tax', 'Banking and payments', 'Records and documents', 'Service providers', 'Data protection'], 10, false),
  ('investment', 'Investment advisory', 'Investment strategy, policy and the managers who carry it out.',
    array['Concentration', 'Liquidity', 'Property', 'Family business', 'Currency', 'Investment managers'], 20, false),
  ('estate_legal', 'Estate and legal', 'Wills, trusts, structures and the legal side of passing on wealth.',
    array['Wills and estate planning', 'Incapacity planning', 'Trusts and foundations', 'Entity structure', 'Regulatory filings', 'Beneficial ownership reporting', 'Agreements and contracts'], 30, false),
  ('risk', 'Risk management', 'Insurance, security, reputation and protection against loss.',
    array['Insurance cover', 'Creditor and claim protection', 'Cyber security', 'Physical and travel security', 'Reputation'], 50, false),
  ('leadership', 'Leadership and transition', 'Succession in the business and the family, and preparing successors.',
    array['Leadership succession', 'Ownership transfer', 'Key person', 'Preparing successors'], 70, false),
  ('learning', 'Family learning and development', 'Education and development of every generation.',
    array['Education and readiness', 'Next-generation involvement', 'Employment in the family business', 'Financial literacy'], 80, false),
  ('dynamics', 'Family dynamics', 'Relationships, communication and conflict within the family.',
    array['Communication', 'Trust', 'Conflict between members', 'New members (marriage, partners)', 'Branch relations'], 90, false),
  ('health', 'Health and well-being', 'Physical and mental health, and the family''s well-being.',
    array['Well-being', 'Care of older members', 'Key person''s health'], 100, false)
on conflict (key) do nothing;
