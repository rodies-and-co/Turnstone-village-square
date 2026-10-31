-- TEST ONLY. Fictional families and accounts. No passwords: the tests
-- simulate signed-in sessions directly.

insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'super.user@example.test'),
  ('20000000-0000-4000-8000-000000000001', 'system.admin@example.test'),
  ('30000000-0000-4000-8000-000000000001', 'hartley.manager@example.test'),
  ('40000000-0000-4000-8000-000000000001', 'hartley.administrator@example.test'),
  ('50000000-0000-4000-8000-000000000001', 'hartley.viewer.family@example.test'),
  ('50000000-0000-4000-8000-000000000002', 'hartley.viewer.branch@example.test'),
  ('50000000-0000-4000-8000-000000000003', 'hartley.viewer.own@example.test'),
  ('50000000-0000-4000-8000-000000000004', 'hartley.viewer.mfa@example.test'),
  ('60000000-0000-4000-8000-000000000001', 'okafor.manager@example.test'),
  ('70000000-0000-4000-8000-000000000001', 'nobody@example.test');

insert into auth.mfa_factors (user_id, status) values
  ('10000000-0000-4000-8000-000000000001', 'verified'),
  ('20000000-0000-4000-8000-000000000001', 'verified'),
  ('30000000-0000-4000-8000-000000000001', 'verified'),
  ('40000000-0000-4000-8000-000000000001', 'verified'),
  ('50000000-0000-4000-8000-000000000004', 'verified'),
  ('60000000-0000-4000-8000-000000000001', 'verified');

insert into public.families (id, name) values
  ('a0000000-0000-4000-8000-000000000001', 'Hartley'),
  ('b0000000-0000-4000-8000-000000000001', 'Okafor');

insert into public.staff (user_id, display_name, system_role) values
  ('10000000-0000-4000-8000-000000000001', 'Test Super User', 'super_user'),
  ('20000000-0000-4000-8000-000000000001', 'Test System Admin', 'system_admin'),
  ('30000000-0000-4000-8000-000000000001', 'Test Manager', null),
  ('40000000-0000-4000-8000-000000000001', 'Test Administrator', null),
  ('60000000-0000-4000-8000-000000000001', 'Test Manager Two', null);

insert into public.family_access (family_id, user_id, role) values
  ('a0000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'manager'),
  ('a0000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'administrator'),
  ('a0000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'viewer'),
  ('a0000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', 'viewer'),
  ('a0000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000003', 'viewer'),
  ('a0000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000004', 'viewer'),
  ('b0000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 'manager');
