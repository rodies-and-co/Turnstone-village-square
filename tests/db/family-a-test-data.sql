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
