-- TEST ONLY. The fictional Okafor family's own database.

insert into public.family_settings (family_id, family_name, hub_issuer)
values ('b0000000-0000-4000-8000-000000000001', 'Okafor', 'https://hub-test.supabase.co/auth/v1');

insert into public.people (member_type, full_names, surname, known_as, birth_year) values
  ('family', 'Ngozi Ada', 'Okafor', 'Ngozi', 1955),
  ('family', 'Emeka John', 'Okafor', 'Emeka', 1982);
