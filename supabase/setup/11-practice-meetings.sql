-- FAMILY project (practice families only: Hartley or Visser, both fictional).
-- Run in each practice family's SQL Editor AFTER
-- supabase/family/migrations/20261113000000_meetings.sql.
--
-- Adds something to look at under Meetings & resolutions:
--   - a quorum of "a majority" for every board, every company's members and
--     every governance body that has none recorded yet;
--   - a confirmed board meeting of the family's company (minute 1), with its
--     directors present, approving the annual accounts and any share
--     transfer still waiting for approval (the waiting transfer is linked to
--     that decision, so it can now be approved);
--   - a file note.
-- Safe to run more than once. Never use this file for a real family: it
-- refuses to run unless the database is marked as a practice family.

do $$
declare
  fam text;
  co uuid;
  m uuid;
  d uuid;
  meeting_day date;
  chair_done boolean := false;
  a record;
begin
  select family_name into fam from public.family_settings;
  if not coalesce((select to_jsonb(s)->>'is_practice' from public.family_settings s)::boolean, false) then
    raise exception 'This script is only for practice families, and % isn''t marked as one.', fam;
  end if;

  update public.entities set board_quorum_rule = 'majority' where board_quorum_rule is null;
  update public.entities set members_quorum_rule = 'majority' where members_quorum_rule is null and entity_type in ('company', 'llc');
  update public.governance_bodies set quorum_rule = 'majority' where quorum_rule is null;

  select id into co from public.entities where entity_type = 'company' order by name limit 1;
  if co is null then
    raise notice 'No company yet: quorums set, nothing else added.';
    return;
  end if;
  if exists (select 1 from public.meetings where entity_id = co) then
    raise notice 'This company already has meetings: quorums set, nothing else added.';
    return;
  end if;

  -- The meeting is held on or before any waiting transfer, so its decision
  -- can approve it.
  meeting_day := least(current_date - 7,
    coalesce((select min(transaction_date) from public.share_transactions where entity_id = co and status = 'draft'), current_date - 7));

  insert into public.meetings (body, entity_id, title, meeting_on, starts_at, location, agenda, status, quorum_met, minutes, minutes_status)
  values ('board', co, 'Board meeting', meeting_day, '10:00', 'By video',
          E'1. Annual accounts\n2. Share transfer', 'confirmed', true,
          'The chair welcomed the directors. The accounts were presented and discussed.', 'circulated')
  returning id into m;

  for a in
    select person_id, organisation_id, holder_entity_id from public.appointments
    where entity_id = co and role = 'director'
      and (appointed_on is null or appointed_on <= meeting_day) and (ceased_on is null or ceased_on > meeting_day)
  loop
    insert into public.meeting_attendees (meeting_id, person_id, organisation_id, holder_entity_id, is_chair)
    values (m, a.person_id, a.organisation_id, a.holder_entity_id, not chair_done and a.person_id is not null)
    on conflict do nothing;
    chair_done := chair_done or a.person_id is not null;
  end loop;

  insert into public.decisions (meeting_id, item, title, wording, outcome, passed_on)
  values (m, 1, 'Annual accounts', 'It was resolved that the accounts for the last financial year be approved.', 'carried', meeting_day);

  if exists (select 1 from public.share_transactions where entity_id = co and status = 'draft' and basis is null) then
    insert into public.decisions (meeting_id, item, title, wording, outcome, passed_on)
    values (m, 2, 'Share transfer', 'It was resolved that the share transfer waiting for approval be approved and entered in the register of members.', 'carried', meeting_day)
    returning id into d;
    update public.share_transactions set basis = 'decision', decision_id = d where entity_id = co and status = 'draft' and basis is null;
  end if;

  insert into public.file_notes (entity_id, title, kind, noted_on, noted_at, body)
  values (co, 'Call with the registered agent', 'phone_call', current_date - 2, '11:15',
          'Practice note: the agent confirmed the annual fee is paid and asked for updated passport copies of the directors.');

  raise notice 'Added a confirmed board meeting (minute 1) and a file note for the company.';
end;
$$;
