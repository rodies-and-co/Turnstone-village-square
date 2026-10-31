-- HUB project. Adds the two fictional practice families.
-- Run once in the hub's SQL Editor, after the hub migration.
-- Real families are added the same way later, by the Super User.

insert into public.families (name) values ('Hartley'), ('Visser')
on conflict (name) do nothing;

-- Check: you should see both families and their ids. You need each id when
-- setting up that family's own database.
select id, name, status from public.families order by name;
