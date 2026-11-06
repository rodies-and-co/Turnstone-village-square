-- Email reminders (owner, 5 Nov 2026): sent automatically, counts only, no
-- link to follow; each person chooses how often (weekly to start); for the
-- team and family members.
--
-- The scheduled job that sends them has no one signed in, so it can't read
-- the family's records the normal way. Instead it uses one narrow login,
-- "vs_reminders", which can do exactly one thing here: ask how many items are
-- waiting for each person. It can't read any table, any name, title or
-- detail. Its password is set by the owner (supabase/setup/15-reminders.sql)
-- and kept only in the website's settings (Vercel). This is a written-down
-- exception to "no secret keys" in CLAUDE.md, limited to counts.

create schema if not exists reminders;
revoke all on schema reminders from public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'vs_reminders') then
    create role vs_reminders nologin noinherit;
  end if;
end;
$$;
grant usage on schema reminders to vs_reminders;

-- How many items are waiting for each person: [{"user_id": …, "role": …}]
-- comes from the hub (the family database doesn't hold roles). Returns only
-- people with something waiting.
create function reminders.counts(p_people jsonb)
returns table (user_id uuid, counts jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Europe/London')::date;
  person record;
  c jsonb;
  team boolean;
  manager boolean;
begin
  for person in select (x ->> 'user_id')::uuid as id, x ->> 'role' as role from jsonb_array_elements(coalesce(p_people, '[]')) x loop
    team := person.role in ('manager', 'administrator', 'super_user');
    manager := person.role in ('manager', 'super_user');
    c := jsonb_strip_nulls(jsonb_build_object(
      'todos_overdue', case when team then (select nullif(count(*), 0) from public.todos t
        where t.assigned_to = person.id and t.status = 'open' and t.due_on < today) end,
      'todos_this_week', case when team then (select nullif(count(*), 0) from public.todos t
        where t.assigned_to = person.id and t.status = 'open' and t.due_on between today and today + 7) end,
      'risk_reviews', case when team then (select nullif(count(*), 0) from public.risks r
        where r.owner_id = person.id and r.status = 'open' and r.next_review_on <= today + 14) end,
      'approvals', case when manager then nullif(
        (select count(*) from public.risk_reviews v where v.status = 'draft' and v.prepared_by is distinct from person.id and not person.id = any (v.changed_by))
        + (select count(*) from public.removal_requests q where q.status = 'pending' and q.requested_by <> person.id)
        + (select count(*) from public.share_transactions s where s.status = 'draft' and s.prepared_by is distinct from person.id and not person.id = any (s.edited_by))
        + (select count(*) from public.meetings m where m.status = 'held')
        + (select count(*) from public.written_resolutions w where w.status = 'circulated'), 0) end,
      'stories_to_review', case when team then (select nullif(count(*), 0) from public.stories s where s.status = 'suggested') end,
      'my_stories_reviewed', (select nullif(count(*), 0) from public.stories s
        where s.submitted_by = person.id and s.status <> 'suggested' and s.reviewed_at > now() - interval '7 days')
    ));
    if c <> '{}'::jsonb then
      user_id := person.id;
      counts := c;
      return next;
    end if;
  end loop;
end;
$$;
revoke all on function reminders.counts(jsonb) from public;
grant execute on function reminders.counts(jsonb) to vs_reminders;
