-- FAMILY project (practice families only: Hartley or Visser, both fictional).
-- Run in each practice family's SQL Editor AFTER
-- supabase/family/migrations/20261103000000_tree_improvements.sql.
--
-- It:
--   1. names each branch after the person who heads it, e.g. "Sarah Hartley Branch";
--   2. adds the practice family's marriages and parent links.
-- Safe to run more than once: anything already recorded is left as it is,
-- and anything the family database refuses is reported and skipped.
-- Never use this file for a real family.

do $$
declare
  fam text := (select family_name from public.family_settings);
  links text[][];
  marriages text[][];
  heads text[][];
  item text[];
  a uuid;
  b uuid;
  -- Finds a practice person by Known as, surname and year of birth.
  q constant text := 'select id from public.people where known_as = $1 and surname = $2 and birth_year = $3::int';
begin
  if fam = 'Hartley' then
    -- {old branch name, new branch name, head: known as, surname, year}
    heads := array[
      array['First branch',  'Tom Hartley Branch',   'Tom',   'Hartley', '1975'],
      array['Second branch', 'Sarah Hartley Branch', 'Sarah', 'Hartley', '1978']];
    -- {person A, person B} as known as / surname / year
    marriages := array[
      array['George', 'Hartley', '1946', 'Maggie', 'Hartley', '1949']];
    -- {parent, child}
    links := array[
      array['George', 'Hartley', '1946', 'Tom',   'Hartley', '1975'],
      array['Maggie', 'Hartley', '1949', 'Tom',   'Hartley', '1975'],
      array['George', 'Hartley', '1946', 'Sarah', 'Hartley', '1978'],
      array['Maggie', 'Hartley', '1949', 'Sarah', 'Hartley', '1978'],
      array['Tom',    'Hartley', '1975', 'Emily', 'Hartley', '2004']];
  elsif fam = 'Visser' then
    heads := array[
      array['Pieter branch',  'Pieter Visser Branch',    'Pieter',  'Visser',   '1972'],
      array['Marieke branch', 'Marieke van Dijk Branch', 'Marieke', 'van Dijk', '1976']];
    marriages := array[
      array['Hans',    'Visser',   '1944', 'Lies',  'Visser',   '1947'],
      array['Pieter',  'Visser',   '1972', 'Sanne', 'Visser',   '1975'],
      array['Marieke', 'van Dijk', '1976', 'Tom',   'van Dijk', '1974']];
    links := array[
      array['Hans',    'Visser',   '1944', 'Pieter',  'Visser',   '1972'],
      array['Lies',    'Visser',   '1947', 'Pieter',  'Visser',   '1972'],
      array['Hans',    'Visser',   '1944', 'Marieke', 'van Dijk', '1976'],
      array['Lies',    'Visser',   '1947', 'Marieke', 'van Dijk', '1976'],
      array['Pieter',  'Visser',   '1972', 'Daan',    'Visser',   '2001'],
      array['Sanne',   'Visser',   '1975', 'Daan',    'Visser',   '2001'],
      array['Marieke', 'van Dijk', '1976', 'Lotte',   'van Dijk', '2005'],
      array['Tom',     'van Dijk', '1974', 'Lotte',   'van Dijk', '2005']];
  else
    raise exception 'This script is only for the practice families Hartley and Visser (this is %).', fam;
  end if;

  -- 1. Branch names and heads.
  foreach item slice 1 in array heads loop
    execute q into a using item[3], item[4], item[5];
    if a is null then
      raise notice 'Skipped branch %: % % (%) not found.', item[2], item[3], item[4], item[5];
      continue;
    end if;
    -- Use the branch that already has the new name if there is one;
    -- otherwise rename the old one.
    update public.branches set head_person_id = a where name = item[2];
    if not found then
      update public.branches set name = item[2], head_person_id = a where name = item[1];
      if not found then raise notice 'Skipped: no branch called "%" or "%".', item[1], item[2]; end if;
    elsif exists (select 1 from public.branches where name = item[1]) then
      raise notice 'Both "%" and "%" exist. The new one now has the head; move people across to it; the old one can be removed once the Branches page is built.', item[1], item[2];
    end if;
  end loop;

  -- 2. Marriages.
  foreach item slice 1 in array marriages loop
    execute q into a using item[1], item[2], item[3];
    execute q into b using item[4], item[5], item[6];
    if a is null or b is null then
      raise notice 'Skipped marriage % and %: someone not found.', item[1], item[4];
      continue;
    end if;
    if exists (select 1 from public.partnerships where person_a = least(a, b) and person_b = greatest(a, b)) then
      continue;
    end if;
    begin
      insert into public.partnerships (person_a, person_b, kind) values (a, b, 'marriage');
    exception when others then
      raise notice 'Skipped marriage % and %: %', item[1], item[4], sqlerrm;
    end;
  end loop;

  -- 3. Parents and children.
  foreach item slice 1 in array links loop
    execute q into a using item[1], item[2], item[3];
    execute q into b using item[4], item[5], item[6];
    if a is null or b is null then
      raise notice 'Skipped % as parent of %: someone not found.', item[1], item[4];
      continue;
    end if;
    if exists (select 1 from public.parent_child where parent_id = a and child_id = b) then
      continue;
    end if;
    begin
      insert into public.parent_child (parent_id, child_id, kind) values (a, b, 'birth')
      on conflict do nothing;
    exception when others then
      raise notice 'Skipped % as parent of %: %', item[1], item[4], sqlerrm;
    end;
  end loop;
end;
$$;

-- Check: branches with their heads, and the family links.
select b.name as branch, p.known_as || ' ' || p.surname as head
from public.branches b left join public.people p on p.id = b.head_person_id
order by b.name;
