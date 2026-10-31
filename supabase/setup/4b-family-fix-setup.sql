-- FAMILY project (Hartley). Use this if 4-family-first-setup.sql was run
-- before the values were filled in. Run it in the HARTLEY project's SQL Editor.
--
-- It removes a settings row that still has the example values (if there is
-- one), then sets the right ones. It refuses to touch a row that already has
-- real values. The removal is recorded in the audit log.
--
-- CHANGE THIS (one line below): the hub's sign-in address, which is the hub's
-- Project URL with /auth/v1 added, e.g. https://horfbnxbeahaprdvfsqs.supabase.co/auth/v1

do $$
declare
  v_family uuid := '9e86fc93-7a37-4e8c-9a34-617577e109c6';   -- Hartley's id in the hub
  v_name text := 'Hartley';
  v_hub text := 'https://your-hub-ref.supabase.co/auth/v1';   -- CHANGE THIS
begin
  if v_hub like '%your-hub-ref%' then
    raise exception 'Fill in the hub address first (the line marked CHANGE THIS).';
  end if;

  if exists (
    select 1 from public.family_settings
    where family_id = '00000000-0000-0000-0000-000000000000'
       or hub_issuer like '%your-hub-ref%'
  ) then
    alter table public.family_settings disable trigger family_settings_no_delete;
    delete from public.family_settings;
    alter table public.family_settings enable trigger family_settings_no_delete;
  end if;

  if exists (select 1 from public.family_settings) then
    raise exception 'This database is already set up with real values. Nothing was changed. Ask Claude before going further.';
  end if;

  insert into public.family_settings (family_id, family_name, hub_issuer)
  values (v_family, v_name, v_hub);
end
$$;

-- Check: one row, with Hartley's id and your hub address.
select family_id, family_name, hub_issuer from public.family_settings;
