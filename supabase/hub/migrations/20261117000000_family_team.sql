-- Turnstone Village Square: who a to-do can be given to (hub)
--
-- The owner (3 Nov 2026): a to-do is given to someone with a login: a
-- Manager or Administrator of the family (or the Super User). The family's
-- Managers and Administrators may see that list (name and role) to choose
-- from. Nobody else's details are shown.

create function public.family_team(p_family uuid)
returns table (user_id uuid, name text, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.user_id, t.name, t.role from (
    select a.user_id, coalesce(s.display_name, u.email::text, 'A team member') as name, a.role::text as role
    from public.family_access a
    join auth.users u on u.id = a.user_id
    left join public.staff s on s.user_id = a.user_id
    where a.family_id = p_family and a.role in ('manager', 'administrator')
    union
    select s.user_id, s.display_name, 'super_user'
    from public.staff s
    where s.system_role = 'super_user'
  ) t
  where private.is_super_user() or private.my_family_role(p_family) in ('manager', 'administrator')
  order by t.name;
$$;
revoke all on function public.family_team(uuid) from public, anon;
grant execute on function public.family_team(uuid) to authenticated;
