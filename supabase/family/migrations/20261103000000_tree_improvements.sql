-- Turnstone Village Square: Tree improvements (family database)
--
-- 1. Branches are named after the person who heads them, e.g. "Sarah Hartley
--    Branch" for Sarah, a child of the founders. head_person_id records who
--    that is. If that person is removed, the branch stays and the link clears.
-- 2. Sense checks on family links, so the Tree can't record something
--    impossible:
--    - a birth parent must be born before their child (when both years are
--      known). Step, foster and adoptive parents are not checked: a step-parent
--      can be younger than a step-child. Checked when a link is added and
--      whenever a year of birth changes;
--    - a parent and their child can't also be spouses or partners.
--    Messages start with "Family link: " so the app can show them as they are.
--    The checks run with the signed-in person's own permissions (not
--    security definer), so they can never reveal anything about people that
--    person isn't allowed to see. Viewers are refused by the access rules anyway.

alter table public.branches
  add column head_person_id uuid references public.people (id) on delete set null;

create function private.check_parent_child_sense()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_year integer;
  child_year integer;
begin
  select birth_year into parent_year from public.people where id = new.parent_id;
  select birth_year into child_year from public.people where id = new.child_id;
  if new.kind = 'birth' and parent_year is not null and child_year is not null and parent_year >= child_year then
    raise exception 'Family link: A parent must be born before their child (% and %).', parent_year, child_year;
  end if;
  if exists (
    select 1 from public.partnerships
    where person_a = least(new.parent_id, new.child_id) and person_b = greatest(new.parent_id, new.child_id)
  ) then
    raise exception 'Family link: These two are recorded as spouses or partners, so one can''t be the other''s parent.';
  end if;
  return new;
end;
$$;

create trigger parent_child_sense before insert or update on public.parent_child
  for each row execute function private.check_parent_child_sense();

-- The same check when a year of birth changes (directly, or through a full
-- date of birth being recorded).
create function private.check_birth_year_sense()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.birth_year is null then
    return new;
  end if;
  if exists (
    select 1 from public.parent_child pc join public.people c on c.id = pc.child_id
    where pc.parent_id = new.id and pc.kind = 'birth' and c.birth_year is not null and c.birth_year <= new.birth_year
  ) then
    raise exception 'Family link: % would make this person born after (or in the same year as) their own child. Please check the years of birth.', new.birth_year;
  end if;
  if exists (
    select 1 from public.parent_child pc join public.people p on p.id = pc.parent_id
    where pc.child_id = new.id and pc.kind = 'birth' and p.birth_year is not null and p.birth_year >= new.birth_year
  ) then
    raise exception 'Family link: % would make this person born before (or in the same year as) their own birth parent. Please check the years of birth.', new.birth_year;
  end if;
  return new;
end;
$$;

create trigger people_birth_year_sense after update of birth_year on public.people
  for each row when (new.birth_year is distinct from old.birth_year)
  execute function private.check_birth_year_sense();

create function private.check_partnership_sense()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.parent_child
    where (parent_id = new.person_a and child_id = new.person_b)
       or (parent_id = new.person_b and child_id = new.person_a)
  ) then
    raise exception 'Family link: These two are recorded as parent and child, so they can''t be spouses or partners.';
  end if;
  return new;
end;
$$;

create trigger partnerships_sense before insert or update on public.partnerships
  for each row execute function private.check_partnership_sense();

revoke all on function private.check_parent_child_sense(), private.check_partnership_sense(),
  private.check_birth_year_sense() from public;
