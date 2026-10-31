-- FAMILY project. Tells a new family database which family it belongs to and
-- which hub it trusts. Run ONCE in the family project's SQL Editor, after the
-- family migration. These two values can never be changed afterwards.
--
-- CHANGE THIS 1: the family's id from the hub (from 1-hub-add-families.sql).
-- CHANGE THIS 2: the family's name.
-- CHANGE THIS 3: the hub's sign-in address: https://<hub project ref>.supabase.co/auth/v1
--                (the hub's Project URL with /auth/v1 added at the end).

insert into public.family_settings (family_id, family_name, hub_issuer)
values (
  '00000000-0000-0000-0000-000000000000',             -- CHANGE THIS 1
  'Hartley',                                          -- CHANGE THIS 2
  'https://your-hub-ref.supabase.co/auth/v1'          -- CHANGE THIS 3
);

select * from public.family_settings;
