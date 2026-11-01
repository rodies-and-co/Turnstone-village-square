-- FAMILY project (practice families only: Hartley or Visser, both fictional).
-- Run in a practice family's SQL Editor whenever something is waiting for a
-- second person's approval and you are the only person using the system.
--
-- It approves, as a fictional "practice approver" (a second Manager who
-- exists only in practice families):
--   - every draft share transaction, oldest first;
--   - every waiting removal request (once two-person removals are installed).
-- All the normal checks still run (authorised shares, holdings, date order,
-- certificate numbers, unchanged records). Anything that fails a check stays
-- waiting, and the reason is listed. Every approval is in the history, under
-- the practice approver.
--
-- Never use this file for a real family: it refuses to run unless the family
-- is Hartley or Visser.

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
  if fam is null or fam not in ('Hartley', 'Visser') then
    raise exception 'This script is only for the practice families Hartley and Visser (this is %).', fam;
  end if;

  -- Act as the practice approver, a Manager of this family with two-factor.
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', approver, 'role', 'authenticated', 'aal', 'aal2', 'iss', iss,
    'vs', jsonb_build_object('families', jsonb_build_object(fid::text, 'manager'), 'mfa', true)
  )::text, true);

  for r in select id, kind, shares from public.share_transactions where status = 'draft' order by transaction_date, created_at loop
    begin
      update public.share_transactions set status = 'approved' where id = r.id;
      done_count := done_count + 1;
    exception when others then
      problems := problems || E'\n  Share transaction (' || r.kind || ', ' || r.shares || ' shares): ' || regexp_replace(sqlerrm, '^Shares: ', '');
    end;
  end loop;

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
order by 2;
