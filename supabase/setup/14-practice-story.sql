-- FAMILY project (practice families only: Hartley or Visser, both fictional).
-- Run in each practice family's SQL Editor AFTER
-- supabase/family/migrations/20261121000000_story.sql.
--
-- Adds three practice stories to look at under The Story: two in the family
-- story's chapters (for the whole family), and one about the family's eldest
-- person (for the people it is about only). Safe to run more than once.
-- Never use this file for a real family: it refuses to run unless the
-- database is marked as a practice family.

do $$
declare
  fam text;
  eldest uuid;
begin
  select family_name into fam from public.family_settings;
  if not coalesce((select to_jsonb(s)->>'is_practice' from public.family_settings s)::boolean, false) then
    raise exception 'This script is only for practice families, and % isn''t marked as one.', fam;
  end if;
  if exists (select 1 from public.stories where title like 'Practice: %') then
    raise notice 'The practice stories are already there.';
    return;
  end if;
  select id into eldest from public.people where member_type = 'family' and birth_year is not null order by birth_year, surname limit 1;

  perform public.add_story(jsonb_build_object(
    'title', 'Practice: where the family began',
    'body', 'The family''s first home was a small house by the river. Every Sunday the whole family ate together, and the children were expected to say one thing they had learnt that week.',
    'told_by', 'Practice story', 'happened_on', '1950-01-01', 'precision', 'year', 'place', 'By the river',
    'themes', jsonb_build_array('origins', 'family_life', 'traditions'),
    'chapter_id', (select id from public.story_chapters where title = 'Origins' limit 1),
    'audience', 'family'), null);
  perform public.add_story(jsonb_build_object(
    'title', 'Practice: the first shop',
    'body', 'The business started with one shop and a borrowed van. The rule was simple: never sell anything you would not buy yourself.',
    'told_by', 'Practice story', 'happened_on', '1968-01-01', 'precision', 'year',
    'themes', jsonb_build_array('work_and_wealth', 'values_and_faith', 'lessons'),
    'chapter_id', (select id from public.story_chapters where title = 'How the wealth was made' limit 1),
    'audience', 'family'), null);
  if eldest is not null then
    perform public.add_story(jsonb_build_object(
      'title', 'Practice: what my parents taught me about money',
      'body', 'Save first, spend second, and always give something away.',
      'prompt', 'What did your parents teach you about money?',
      'themes', jsonb_build_array('lessons', 'values_and_faith'),
      'audience', 'people'), array[eldest]);
  end if;
  raise notice 'Practice stories added to %.', fam;
end;
$$;
