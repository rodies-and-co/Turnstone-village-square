-- FAMILY project (practice families only: Hartley or Visser, both fictional).
-- Run in each practice family's SQL Editor AFTER
-- supabase/family/migrations/20261106000000_organisation.sql.
--
-- Adds fictional entities, an outside organisation and some officers, so
-- there is something to look at in The Organisation. The setup checklists
-- will show what is still missing, on purpose.
-- Safe to run more than once. Never use this file for a real family.

do $$
declare
  fam text := (select family_name from public.family_settings);
  q constant text := 'select id from public.people where known_as = $1 and surname = $2 and birth_year = $3::int';
  e1 uuid;
  e2 uuid;
  org uuid;
  p uuid;
begin
  if fam = 'Hartley' then
    insert into public.outside_organisations (name, kind, jurisdiction)
    values ('Example Trust Company (Pty) Ltd', 'trust_company', 'South Africa')
    on conflict do nothing;
    select id into org from public.outside_organisations where name = 'Example Trust Company (Pty) Ltd';

    insert into public.entities (name, entity_type, jurisdiction, sub_type, registration_number, base_currency, year_end_month, year_end_day, activity)
    values ('Hartley Holdings Ltd', 'company', 'United Kingdom', 'Private company limited by shares', 'TEST0001', 'GBP', 3, 31, 'Holding company for the family business')
    on conflict do nothing;
    insert into public.entities (name, entity_type, jurisdiction, sub_type, base_currency, year_end_month, year_end_day, activity)
    values ('Hartley Family Trust', 'trust', 'South Africa', 'Inter vivos trust', 'ZAR', 2, 28, 'Holds the family''s shares for future generations')
    on conflict do nothing;
    select id into e1 from public.entities where name = 'Hartley Holdings Ltd';
    select id into e2 from public.entities where name = 'Hartley Family Trust';

    execute q into p using 'George', 'Hartley', '1946';
    if p is not null and not exists (select 1 from public.appointments where entity_id = e1 and person_id = p and ceased_on is null) then
      insert into public.appointments (entity_id, role, person_id, identity_verified) values (e1, 'director', p, true);
    end if;
    execute q into p using 'Tom', 'Hartley', '1975';
    if p is not null and not exists (select 1 from public.appointments where entity_id = e1 and person_id = p and ceased_on is null) then
      insert into public.appointments (entity_id, role, person_id) values (e1, 'director', p);
    end if;
    execute q into p using 'Maggie', 'Hartley', '1949';
    if p is not null and not exists (select 1 from public.appointments where entity_id = e2 and person_id = p and ceased_on is null) then
      insert into public.appointments (entity_id, role, person_id) values (e2, 'trustee', p);
    end if;
    if not exists (select 1 from public.appointments where entity_id = e2 and organisation_id = org and ceased_on is null) then
      insert into public.appointments (entity_id, role, organisation_id, licensed) values (e2, 'trustee', org, true);
    end if;

  elsif fam = 'Visser' then
    insert into public.outside_organisations (name, kind, jurisdiction)
    values ('Example Agents Ltd', 'registered_agent', 'British Virgin Islands')
    on conflict do nothing;
    select id into org from public.outside_organisations where name = 'Example Agents Ltd';

    insert into public.entities (name, entity_type, jurisdiction, sub_type, registration_number, base_currency, year_end_month, year_end_day, activity)
    values ('Visser Holdings Limited', 'company', 'British Virgin Islands', 'BVI Business Company', 'TEST0002', 'USD', 12, 31, 'Holding company')
    on conflict do nothing;
    insert into public.entities (name, entity_type, jurisdiction, sub_type, base_currency, activity)
    values ('Visser Foundation', 'foundation', 'Mauritius', 'Foundation', 'USD', 'Education and charitable giving')
    on conflict do nothing;
    select id into e1 from public.entities where name = 'Visser Holdings Limited';
    select id into e2 from public.entities where name = 'Visser Foundation';

    if not exists (select 1 from public.appointments where entity_id = e1 and organisation_id = org and ceased_on is null) then
      insert into public.appointments (entity_id, role, organisation_id, licensed) values (e1, 'registered_agent', org, true);
    end if;
    execute q into p using 'Pieter', 'Visser', '1972';
    if p is not null and not exists (select 1 from public.appointments where entity_id = e1 and person_id = p and ceased_on is null) then
      insert into public.appointments (entity_id, role, person_id) values (e1, 'director', p);
    end if;
    execute q into p using 'Hans', 'Visser', '1944';
    if p is not null and not exists (select 1 from public.appointments where entity_id = e2 and person_id = p and ceased_on is null) then
      insert into public.appointments (entity_id, role, person_id) values (e2, 'council_member', p);
    end if;
  else
    raise exception 'This script is only for the practice families Hartley and Visser (this is %).', fam;
  end if;
end;
$$;

select e.name, e.jurisdiction, e.sub_type, count(a.id) as officers
from public.entities e left join public.appointments a on a.entity_id = e.id and a.ceased_on is null
group by 1, 2, 3 order by 1;
