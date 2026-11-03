-- FAMILY project (practice families only: Hartley or Visser, both fictional).
-- Run in a practice family's SQL Editor whenever something is waiting for a
-- second person's approval and you are the only person using the system.
--
-- It approves, as a fictional "practice approver" (a second Manager who
-- exists only in practice families):
--   - every meeting recorded as held (it confirms the record), oldest first;
--   - every circulated written resolution with enough signatures (it confirms
--     it has passed);
--   - the circulated minutes of confirmed meetings (recorded as approved
--     today, without a signatory);
--   - every draft share transaction, oldest first;
--   - every risk rating waiting for approval (once Risk management is installed);
--   - every waiting removal request (once two-person removals are installed).
-- All the normal checks still run (authorised shares, holdings, date order,
-- certificate numbers, unchanged records). Anything that fails a check stays
-- waiting, and the reason is listed. Every approval is in the history, under
-- the practice approver.
--
-- Never use this file for a real family: it refuses to run unless the
-- database is marked as a practice family (a mark that can't be changed).

do $$
declare
  fam text;
  fid uuid;
  iss text;
  approver constant uuid := '00000000-0000-4000-8000-0000000a99e0'; -- the practice approver
  r record;
  done_count integer := 0;
  problems text := '';
begin
  select family_name, family_id, hub_issuer into fam, fid, iss from public.family_settings;
  if not coalesce((select to_jsonb(s)->>'is_practice' from public.family_settings s)::boolean, false) then
    raise exception 'This script is only for practice families, and % isn''t marked as one.', fam;
  end if;

  -- Act as the practice approver, a Manager of this family with two-factor.
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', approver, 'role', 'authenticated', 'aal', 'aal2', 'iss', iss,
    'vs', jsonb_build_object('families', jsonb_build_object(fid::text, 'manager'), 'mfa', true)
  )::text, true);

  -- Meetings and resolutions first: share transactions may rely on them.
  if to_regclass('public.meetings') is not null then
    for r in execute 'select id, title, meeting_on from public.meetings where status = ''held'' order by meeting_on' loop
      begin
        execute 'update public.meetings set status = ''confirmed'' where id = $1' using r.id;
        done_count := done_count + 1;
      exception when others then
        problems := problems || E'\n  Meeting (' || r.title || ', ' || to_char(r.meeting_on, 'DD/MM/YYYY') || '): ' || regexp_replace(sqlerrm, '^Meetings: ', '');
      end;
    end loop;
    for r in execute 'select id, title from public.written_resolutions where status = ''circulated'' order by circulated_on' loop
      begin
        execute 'update public.written_resolutions set status = ''passed'' where id = $1' using r.id;
        done_count := done_count + 1;
      exception when others then
        problems := problems || E'\n  Resolution (' || r.title || '): ' || regexp_replace(sqlerrm, '^Resolutions: ', '');
      end;
    end loop;
    for r in execute 'select id, title, meeting_on from public.meetings where status = ''confirmed'' and minutes_status = ''circulated'' order by meeting_on' loop
      begin
        execute 'update public.meetings set minutes_status = ''approved'', minutes_approved_on = current_date where id = $1' using r.id;
        done_count := done_count + 1;
      exception when others then
        problems := problems || E'\n  Minutes (' || r.title || ', ' || to_char(r.meeting_on, 'DD/MM/YYYY') || '): ' || regexp_replace(sqlerrm, '^Meetings: ', '');
      end;
    end loop;
  end if;

  for r in select id, kind, shares from public.share_transactions where status = 'draft' order by transaction_date, created_at loop
    begin
      update public.share_transactions set status = 'approved' where id = r.id;
      done_count := done_count + 1;
    exception when others then
      problems := problems || E'\n  Share transaction (' || r.kind || ', ' || r.shares || ' shares): ' || regexp_replace(sqlerrm, '^Shares: ', '');
    end;
  end loop;

  if to_regclass('public.risk_reviews') is not null then
    for r in execute 'select v.id, k.title from public.risk_reviews v join public.risks k on k.id = v.risk_id where v.status = ''draft'' and v.prepared_by is distinct from $1 order by v.created_at' using approver loop
      begin
        execute 'update public.risk_reviews set status = ''approved'' where id = $1' using r.id;
        done_count := done_count + 1;
      exception when others then
        problems := problems || E'\n  Risk rating (' || r.title || '): ' || regexp_replace(sqlerrm, '^Risks: ', '');
      end;
    end loop;
  end if;

  if to_regclass('public.removal_requests') is not null then
    for r in execute 'select id, summary from public.removal_requests where status = ''pending'' and requested_by <> $1 order by requested_at' using approver loop
      begin
        execute 'select public.decide_removal($1, true)' using r.id;
        done_count := done_count + 1;
      exception when others then
        problems := problems || E'\n  Removal (' || r.summary || '): ' || regexp_replace(sqlerrm, '^Removal: ', '');
      end;
    end loop;
  end if;

  raise notice 'Approved %.%', done_count, case when problems = '' then '' else E'\nStill waiting:' || problems end;
end;
$$;

-- What is still waiting (an empty list means everything was approved).
select 'Share transaction' as waiting, kind || ', ' || shares || ' shares, dated ' || transaction_date as what
from public.share_transactions where status = 'draft'
union all
select 'Risk rating', k.title from public.risk_reviews v join public.risks k on k.id = v.risk_id where v.status = 'draft'
union all
select 'Removal', summary from public.removal_requests where status = 'pending';
