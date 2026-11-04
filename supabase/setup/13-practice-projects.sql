-- FAMILY project (practice families only: Hartley or Visser, both fictional).
-- Run in each practice family's SQL Editor AFTER
-- supabase/family/migrations/20261119000000_projects.sql.
--
-- Adds a practice project to look at under Projects: drafting the Family
-- Constitution, under way, with three goals and their to-dos (some done).
-- Safe to run more than once (it adds nothing if the practice project is
-- there). Never use this file for a real family: it refuses to run unless
-- the database is marked as a practice family.

do $$
declare
  fam text;
  p uuid;
  g1 uuid;
  g2 uuid;
  g3 uuid;
begin
  select family_name into fam from public.family_settings;
  if not coalesce((select to_jsonb(s)->>'is_practice' from public.family_settings s)::boolean, false) then
    raise exception 'This script is only for practice families, and % isn''t marked as one.', fam;
  end if;
  if exists (select 1 from public.projects where title like 'Practice: %') then
    raise notice 'The practice project is already there.';
    return;
  end if;

  insert into public.projects (title, purpose, outcomes, stage, starts_on, target_on)
  values ('Practice: draft the Family Constitution',
    'Agree, in writing, how the family makes decisions together, who may join the Family Council, and how the next generation is prepared.',
    'A Family Constitution adopted by the Family Assembly.',
    'under_way', current_date - 60, current_date + 120)
  returning id into p;

  insert into public.project_goals (project_id, title, target_on, sort, achieved_on)
  values (p, 'Agree the family''s purpose and values', current_date - 10, 10, current_date - 12) returning id into g1;
  insert into public.project_goals (project_id, title, target_on, sort)
  values (p, 'Draft the decision-making rules', current_date + 45, 20) returning id into g2;
  insert into public.project_goals (project_id, title, target_on, sort)
  values (p, 'Hold the Family Assembly to adopt it', current_date + 120, 30) returning id into g3;

  insert into public.todos (title, topic, project_goal_id, status, due_on) values
    ('Run the values workshop', 'projects', g1, 'done', current_date - 30),
    ('Write up the agreed values', 'projects', g1, 'done', current_date - 15),
    ('Collect views from each branch', 'projects', g2, 'done', current_date - 5),
    ('Draft the Family Council section', 'projects', g2, 'open', current_date + 14),
    ('Review the draft with the adviser', 'projects', g2, 'open', current_date + 30),
    ('Book the venue for the Assembly', 'projects', g3, 'open', current_date + 60);
  raise notice 'Practice project added to %.', fam;
end;
$$;
