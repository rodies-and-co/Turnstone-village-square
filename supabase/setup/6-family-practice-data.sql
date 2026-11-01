-- FAMILY project (practice families only). Adds fictional people and
-- branches so there is something to look at. Never use for a real family.

insert into public.branches (name) values ('Tom Hartley Branch'), ('Sarah Hartley Branch')
on conflict (name) do nothing;

insert into public.people (member_type, full_names, surname, known_as, birth_year, three_circle_role, branch_id)
select v.member_type::public.member_type, v.full_names, coalesce(v.surname, s.family_name), v.known_as, v.birth_year,
       v.three_circle_role::public.three_circle_role,
       (select id from public.branches where name = v.branch)
from public.family_settings s,
(values
  ('family', 'George William', null, 'George', 1946, 'family_leader', null),
  ('family', 'Margaret Ann', null, 'Maggie', 1949, 'family_owner', null),
  ('family', 'Thomas George', null, 'Tom', 1975, 'family_employee', 'Tom Hartley Branch'),
  ('family', 'Sarah Jane', null, 'Sarah', 1978, 'family_owner', 'Sarah Hartley Branch'),
  ('family_not_succession', 'Emily Rose', null, 'Emily', 2004, 'family_member', 'Tom Hartley Branch'),
  ('non_family', 'Peter John', 'Marsh', 'Peter', 1968, 'employee', null)
) as v(member_type, full_names, surname, known_as, birth_year, three_circle_role, branch);

select known_as, surname, member_type, three_circle_role from public.people order by birth_year;
