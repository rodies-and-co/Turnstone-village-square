-- HUB project. Gives a Turnstone person a system role.
-- Before running: create their login in Authentication > Users > Add user >
-- Create new user (tick "Auto Confirm User", password of at least 12
-- characters, shared securely).
-- Change the three values marked CHANGE THIS. Safe to run more than once.

with chosen as (
  select
    'name@turnstone-group.com' as email,        -- CHANGE THIS: their login email
    'Their Name'               as display_name, -- CHANGE THIS: how their name shows
    'super_user'               as system_role   -- CHANGE THIS: 'super_user', 'system_admin', or null
)
insert into public.staff (user_id, display_name, system_role)
select u.id, c.display_name, c.system_role::public.system_role
from chosen c
join auth.users u on lower(u.email) = lower(trim(c.email))
on conflict (user_id) do update
  set display_name = excluded.display_name, system_role = excluded.system_role;

select u.email, s.display_name, s.system_role
from public.staff s join auth.users u on u.id = s.user_id
order by u.email;
