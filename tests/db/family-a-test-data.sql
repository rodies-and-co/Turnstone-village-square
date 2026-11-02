-- TEST ONLY. The fictional Hartley family's own database.

insert into public.family_settings (family_id, family_name, hub_issuer)
values ('a0000000-0000-4000-8000-000000000001', 'Hartley', 'https://hub-test.supabase.co/auth/v1');

insert into public.branches (id, name) values
  ('a1000000-0000-4000-8000-000000000001', 'North branch'),
  ('a1000000-0000-4000-8000-000000000002', 'South branch');

insert into public.people (id, member_type, full_names, surname, known_as, birth_year, branch_id, user_id) values
  ('a2000000-0000-4000-8000-000000000001', 'family', 'Arthur James', 'Hartley', 'Arthur', 1948,
   'a1000000-0000-4000-8000-000000000001', null),
  ('a2000000-0000-4000-8000-000000000002', 'family', 'Beatrice Anne', 'Hartley', 'Bea', 1951,
   'a1000000-0000-4000-8000-000000000002', null),
  ('a2000000-0000-4000-8000-000000000003', 'family_not_succession', 'Clara Rose', 'Hartley', 'Clara', 1980,
   null, '50000000-0000-4000-8000-000000000003');

insert into public.access_grants (user_id, scope, branch_id) values
  ('50000000-0000-4000-8000-000000000001', 'whole_family', null),
  ('50000000-0000-4000-8000-000000000002', 'branch', 'a1000000-0000-4000-8000-000000000001'),
  ('50000000-0000-4000-8000-000000000003', 'own_record', null),
  ('50000000-0000-4000-8000-000000000004', 'whole_family', null);

-- The Tree: personal details, documents, addresses and family links.
insert into public.person_details (person_id, date_of_birth, city_of_birth, country_of_birth, email) values
  ('a2000000-0000-4000-8000-000000000001', '1948-05-02', 'Leeds', 'United Kingdom', 'arthur@example.test'),
  ('a2000000-0000-4000-8000-000000000003', '1980-07-14', 'York', 'United Kingdom', 'clara@example.test');

insert into public.passports (person_id, country, number, expires_on) values
  ('a2000000-0000-4000-8000-000000000001', 'United Kingdom', 'TEST1001', '2030-01-01'),
  ('a2000000-0000-4000-8000-000000000003', 'United Kingdom', 'TEST1003', '2031-01-01');

insert into public.tax_numbers (person_id, country, number) values
  ('a2000000-0000-4000-8000-000000000001', 'United Kingdom', 'TESTTAX1');

insert into public.phone_numbers (person_id, label, number) values
  ('a2000000-0000-4000-8000-000000000003', 'Mobile', '+44 7700 900123');

insert into public.addresses (id, line1, city, postal_code, country) values
  ('a3000000-0000-4000-8000-000000000001', '1 Test Lane', 'Leeds', 'LS1 1AA', 'United Kingdom'),
  ('a3000000-0000-4000-8000-000000000002', '2 Sample Road', 'York', 'YO1 1AA', 'United Kingdom');

insert into public.person_addresses (person_id, address_id, kind) values
  ('a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'home'),
  ('a2000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000002', 'home');

-- Arthur and Bea are married; both are Clara's parents.
insert into public.partnerships (person_a, person_b, kind, start_date) values
  ('a2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'marriage', '1972-06-01');

insert into public.parent_child (parent_id, child_id) values
  ('a2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000003'),
  ('a2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000003');

-- The Branches: Arthur (North) is confirmed as a wealth creator.
insert into public.wealth_creators (person_id) values ('a2000000-0000-4000-8000-000000000001');

-- Governance: a Family Council (whole family) and a North branch council.
insert into public.governance_bodies (id, kind, name, branch_id) values
  ('a5000000-0000-4000-8000-000000000001', 'family_council', 'Hartley Family Council', null),
  ('a5000000-0000-4000-8000-000000000002', 'branch_council', 'North Branch Council', 'a1000000-0000-4000-8000-000000000001');
insert into public.body_members (body_id, person_id, role) values
  ('a5000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'chair'),
  ('a5000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'member'),
  ('a5000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'chair');

-- Advisors: one firm, advising the whole family and the South branch.
insert into public.advisors (id, full_name, firm, profession) values
  ('a6000000-0000-4000-8000-000000000001', 'Test Adviser', 'Example LLP', 'lawyer');
insert into public.advisor_roles (advisor_id, branch_id, advises_on) values
  ('a6000000-0000-4000-8000-000000000001', null, 'Trusts and estate planning'),
  ('a6000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'South branch succession');

-- Statements: the family's purpose (draft), and a North branch value.
insert into public.family_statements (id, kind, branch_id, title, body) values
  ('a7000000-0000-4000-8000-000000000001', 'purpose', null, 'Our purpose', 'Test purpose text.'),
  ('a7000000-0000-4000-8000-000000000002', 'values', 'a1000000-0000-4000-8000-000000000001', 'North values', 'Test values text.');

-- The Organisation: a family company, a North branch trust, and a trust company.
insert into public.outside_organisations (id, name, kind) values
  ('a8000000-0000-4000-8000-000000000001', 'Test Trust Company Ltd', 'trust_company');
insert into public.entities (id, name, entity_type, jurisdiction, sub_type, branch_id, base_currency, year_end_month, year_end_day) values
  ('a9000000-0000-4000-8000-000000000001', 'Test Holdings Ltd', 'company', 'United Kingdom', 'Private company limited by shares', null, 'GBP', 3, 31),
  ('a9000000-0000-4000-8000-000000000002', 'North Family Trust', 'trust', 'South Africa', 'Inter vivos trust', 'a1000000-0000-4000-8000-000000000001', 'ZAR', 2, 28);
insert into public.appointments (entity_id, role, person_id, organisation_id) values
  ('a9000000-0000-4000-8000-000000000001', 'director', 'a2000000-0000-4000-8000-000000000001', null),
  ('a9000000-0000-4000-8000-000000000001', 'director', 'a2000000-0000-4000-8000-000000000002', null),
  ('a9000000-0000-4000-8000-000000000002', 'trustee', null, 'a8000000-0000-4000-8000-000000000001');

-- Ownership: Test Holdings Ltd has 1,000 authorised Ordinary shares of £1;
-- 100 issued to the North person and 50 to the trust company (approved),
-- and a draft issue of 10 to the trust company, prepared by the Administrator.
-- The North Family Trust: settled by the North person; the South person is a
-- beneficiary, and the North person is in the class "Descendants".
insert into public.share_classes (id, entity_id, name, currency, par_value) values
  ('aa000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001', 'Ordinary', 'GBP', 1);
insert into public.share_transactions
  (id, entity_id, class_id, kind, transaction_date, shares, to_person_id, to_organisation_id, certificate_number, status, prepared_by, approved_by, approved_at) values
  ('ab000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001', 'authorise', '2020-01-01', 1000, null, null, null,
   'approved', '40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', now()),
  ('ab000000-0000-4000-8000-000000000002', 'a9000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001', 'issue', '2020-01-02', 100,
   'a2000000-0000-4000-8000-000000000001', null, '1', 'approved', '40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', now()),
  ('ab000000-0000-4000-8000-000000000003', 'a9000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001', 'issue', '2020-01-02', 50,
   null, 'a8000000-0000-4000-8000-000000000001', '2', 'approved', '40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', now()),
  ('ab000000-0000-4000-8000-000000000004', 'a9000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001', 'issue', '2021-01-02', 10,
   null, 'a8000000-0000-4000-8000-000000000001', '3', 'draft', '40000000-0000-4000-8000-000000000001', null, null);
-- The draft relies on the formation documents (decisions came later).
update public.share_transactions set basis = 'formation' where id = 'ab000000-0000-4000-8000-000000000004';
insert into public.settlements (entity_id, kind, person_id, settled_on, description, amount, currency) values
  ('a9000000-0000-4000-8000-000000000002', 'initial', 'a2000000-0000-4000-8000-000000000001', '2019-06-01', 'Cash', 100, 'ZAR');
insert into public.beneficiaries (entity_id, person_id) values
  ('a9000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002');
insert into public.beneficiary_classes (id, entity_id, name) values
  ('ac000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000002', 'Descendants');
insert into public.beneficiary_class_members (entity_id, class_id, person_id) values
  ('a9000000-0000-4000-8000-000000000002', 'ac000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001');
