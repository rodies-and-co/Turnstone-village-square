-- FAMILY project (practice families only: Hartley or Visser, both fictional).
-- Run in each practice family's SQL Editor AFTER
-- supabase/family/migrations/20261107000000_ownership.sql and
-- supabase/setup/8-practice-organisation.sql.
--
-- Adds fictional share capital, a register of members, settlors,
-- beneficiaries and classes, so there is something to look at on the
-- Ownership & control tab. One share transfer is left as a draft, so a
-- Manager can try approving it.
-- Safe to run more than once. Never use this file for a real family.

do $$
declare
  fam text := (select family_name from public.family_settings);
  q constant text := 'select id from public.people where known_as = $1 and surname = $2 and birth_year = $3::int';
  setup constant uuid := '00000000-0000-0000-0000-000000000000'; -- stands for "this set-up script"
  co uuid;
  tr uuid;
  cls uuid;
  bcl uuid;
  a uuid;
  b uuid;
begin
  if fam = 'Hartley' then
    select id into co from public.entities where name = 'Hartley Holdings Ltd';
    select id into tr from public.entities where name = 'Hartley Family Trust';
    if co is null or tr is null then
      raise exception 'Please run supabase/setup/8-practice-organisation.sql first.';
    end if;
    execute q into a using 'George', 'Hartley', '1946';
    execute q into b using 'Tom', 'Hartley', '1975';

    insert into public.share_classes (entity_id, name, currency, par_value, limited, voting)
    values (co, 'Ordinary', 'GBP', 1, true, true)
    on conflict do nothing;
    select id into cls from public.share_classes where entity_id = co and name = 'Ordinary';

    if not exists (select 1 from public.share_transactions where class_id = cls) then
      insert into public.share_transactions (entity_id, class_id, kind, transaction_date, shares, resolution, status, approved_by, approved_at)
      values (co, cls, 'authorise', '2005-04-01', 1000, 'Articles of association', 'approved', setup, now());
      insert into public.share_transactions (entity_id, class_id, kind, transaction_date, shares, to_person_id, certificate_number, consideration, resolution, status, approved_by, approved_at)
      values (co, cls, 'issue', '2005-04-01', 600, a, '1', 600, 'Directors'' resolution, 1 April 2005', 'approved', setup, now());
      insert into public.share_transactions (entity_id, class_id, kind, transaction_date, shares, to_entity_id, certificate_number, consideration, resolution, status, approved_by, approved_at)
      values (co, cls, 'issue', '2010-03-01', 400, tr, '2', 400, 'Directors'' resolution, 1 March 2010', 'approved', setup, now());
      if a is not null and b is not null then
        insert into public.share_transactions (entity_id, class_id, kind, transaction_date, shares, from_person_id, to_person_id, certificate_number, balance_certificate_number)
        values (co, cls, 'transfer', current_date, 100, a, b, '3', '4');
      end if;
    end if;

    if a is not null and not exists (select 1 from public.settlements where entity_id = tr) then
      insert into public.settlements (entity_id, kind, person_id, settled_on, description, amount, currency)
      values (tr, 'initial', a, '2010-02-01', 'Cash', 100, 'ZAR');
    end if;

    insert into public.beneficiary_classes (entity_id, name, description)
    values (tr, 'Descendants of George and Maggie Hartley', 'The children and remoter descendants of George and Maggie Hartley')
    on conflict do nothing;
    select id into bcl from public.beneficiary_classes where entity_id = tr and name = 'Descendants of George and Maggie Hartley';
    insert into public.beneficiary_class_members (entity_id, class_id, person_id)
    select tr, bcl, p.id from public.people p
    where p.surname = 'Hartley' and p.known_as in ('Tom', 'Sarah', 'Emily')
      and not exists (select 1 from public.beneficiary_class_members m where m.class_id = bcl and m.person_id = p.id and m.ceased_on is null);

    execute q into b using 'Maggie', 'Hartley', '1949';
    if b is not null and not exists (select 1 from public.beneficiaries where entity_id = tr and person_id = b) then
      insert into public.beneficiaries (entity_id, person_id, interest) values (tr, b, 'discretionary');
    end if;

  elsif fam = 'Visser' then
    select id into co from public.entities where name = 'Visser Holdings Limited';
    select id into tr from public.entities where name = 'Visser Foundation';
    if co is null or tr is null then
      raise exception 'Please run supabase/setup/8-practice-organisation.sql first.';
    end if;
    execute q into a using 'Hans', 'Visser', '1944';
    execute q into b using 'Pieter', 'Visser', '1972';

    -- A BVI company may issue an unlimited number of shares, if its
    -- memorandum allows: no authorised maximum here.
    insert into public.share_classes (entity_id, name, currency, par_value, limited, voting)
    values (co, 'Ordinary', 'USD', null, false, true)
    on conflict do nothing;
    select id into cls from public.share_classes where entity_id = co and name = 'Ordinary';

    if not exists (select 1 from public.share_transactions where class_id = cls) then
      insert into public.share_transactions (entity_id, class_id, kind, transaction_date, shares, to_entity_id, certificate_number, resolution, status, approved_by, approved_at)
      values (co, cls, 'issue', '2015-06-01', 70000, tr, '1', 'Resolution of directors, 1 June 2015', 'approved', setup, now());
      if b is not null then
        insert into public.share_transactions (entity_id, class_id, kind, transaction_date, shares, to_person_id, certificate_number, resolution, status, approved_by, approved_at)
        values (co, cls, 'issue', '2015-06-01', 30000, b, '2', 'Resolution of directors, 1 June 2015', 'approved', setup, now());
      end if;
    end if;

    if a is not null and not exists (select 1 from public.settlements where entity_id = tr) then
      insert into public.settlements (entity_id, kind, person_id, settled_on, description, amount, currency)
      values (tr, 'initial', a, '2015-05-01', 'Initial endowment', 10000, 'USD');
    end if;
    if not exists (select 1 from public.beneficiaries where entity_id = tr and cause is not null) then
      insert into public.beneficiaries (entity_id, cause, interest) values (tr, 'Education in rural communities', 'discretionary');
    end if;

    insert into public.beneficiary_classes (entity_id, name, description)
    values (tr, 'Descendants of Hans Visser', 'The children and remoter descendants of Hans Visser')
    on conflict do nothing;
    select id into bcl from public.beneficiary_classes where entity_id = tr and name = 'Descendants of Hans Visser';
    insert into public.beneficiary_class_members (entity_id, class_id, person_id)
    select tr, bcl, p.id from public.people p
    where p.known_as in ('Pieter', 'Marieke', 'Daan') and p.member_type = 'family'
      and not exists (select 1 from public.beneficiary_class_members m where m.class_id = bcl and m.person_id = p.id and m.ceased_on is null);
  else
    raise exception 'This script is only for the practice families Hartley and Visser (this is %).', fam;
  end if;
end;
$$;
