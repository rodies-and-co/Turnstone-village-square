-- HUB project. Gives a person a role in ONE family: 'manager',
-- 'administrator' or 'viewer'. (Managers can also do this in the app later.)
-- Before running: create their login in Authentication > Users if needed.
-- Change the three values marked CHANGE THIS. Safe to run more than once.
-- The change applies the next time their sign-in refreshes (within minutes),
-- or straight away if they sign out and in again.

with chosen as (
  select
    'name@example.com' as email,   -- CHANGE THIS: their login email
    'Hartley'          as family,  -- CHANGE THIS: the family's name
    'manager'          as role     -- CHANGE THIS: 'manager', 'administrator' or 'viewer'
)
insert into public.family_access (family_id, user_id, role)
select f.id, u.id, c.role::public.family_role
from chosen c
join public.families f on f.name = c.family
join auth.users u on lower(u.email) = lower(trim(c.email))
on conflict (family_id, user_id) do update set role = excluded.role;

select f.name as family, u.email, a.role
from public.family_access a
join public.families f on f.id = a.family_id
join auth.users u on u.id = a.user_id
order by f.name, a.role, u.email;
