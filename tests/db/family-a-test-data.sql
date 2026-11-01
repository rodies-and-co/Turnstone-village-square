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
