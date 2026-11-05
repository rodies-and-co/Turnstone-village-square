-- FAMILY project (practice families only: Hartley or Visser, both fictional).
-- Run in each practice family's SQL Editor AFTER
-- supabase/family/migrations/20261118000000_risks.sql.
--
-- Adds something to look at under Risk management: four risks (about the
-- whole family, the family's first company, and the first branch), each
-- with a draft rating. Run 10-practice-approve.sql afterwards to approve the
-- ratings as the practice approver, so they show on the heat map.
-- Safe to run more than once (it adds nothing if practice risks are there).
-- Never use this file for a real family: it refuses to run unless the
-- database is marked as a practice family.

do $$
declare
  fam text;
  co uuid;
  br uuid;
begin
  select family_name into fam from public.family_settings;
  if not coalesce((select to_jsonb(s)->>'is_practice' from public.family_settings s)::boolean, false) then
    raise exception 'This script is only for practice families, and % isn''t marked as one.', fam;
  end if;
  if exists (select 1 from public.risks where title like 'Practice: %') then
    raise notice 'The practice risks are already there.';
    return;
  end if;
  select id into co from public.entities where entity_type = 'company' and status <> 'dissolved' order by name limit 1;
  select id into br from public.branches order by name limit 1;

  perform public.add_risk(
    jsonb_build_object('title', 'Practice: no agreed plan for the next family leader', 'category', 'leadership', 'subcategory', 'Leadership succession',
      'description', 'If the current leader stepped back suddenly, the family has no agreed way of choosing who leads next.', 'response', 'treat'),
    jsonb_build_object('inherent_likelihood', 4, 'inherent_impact', 5, 'residual_likelihood', 3, 'residual_impact', 4,
      'controls', 'Family Council has started succession conversations.'));
  perform public.add_risk(
    jsonb_build_object('title', 'Practice: most of the wealth is in one company', 'category', 'investment', 'subcategory', 'Concentration',
      'description', 'A downturn in one business would affect every branch.', 'response', 'tolerate'),
    jsonb_build_object('inherent_likelihood', 3, 'inherent_impact', 4, 'residual_likelihood', 3, 'residual_impact', 3,
      'controls', 'Annual review of diversification by the board.'));
  if co is not null then
    perform public.add_risk(
      jsonb_build_object('title', 'Practice: bank mandate depends on one signatory', 'category', 'financial', 'subcategory', 'Banking and payments',
        'entity_id', co, 'response', 'treat'),
      jsonb_build_object('inherent_likelihood', 3, 'inherent_impact', 4, 'residual_likelihood', 2, 'residual_impact', 3,
        'controls', 'A second signatory is being added.'));
  end if;
  if br is not null then
    perform public.add_risk(
      jsonb_build_object('title', 'Practice: younger generation not involved', 'category', 'learning', 'subcategory', 'Education and readiness',
        'branch_id', br, 'response', 'treat'),
      jsonb_build_object('inherent_likelihood', 4, 'inherent_impact', 3, 'residual_likelihood', 2, 'residual_impact', 3,
        'controls', 'Next-generation workshop planned.'));
  end if;
  raise notice 'Practice risks added to %. Run 10-practice-approve.sql to approve their ratings.', fam;
end;
$$;
