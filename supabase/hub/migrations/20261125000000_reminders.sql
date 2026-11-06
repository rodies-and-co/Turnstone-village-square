-- Email reminders (owner, 5 Nov 2026): automatic, counts only, no link; each
-- person chooses how often (weekly to start); for the team and family
-- members.
--
-- Each person's choice is kept here. The scheduled job that sends the
-- emails uses one narrow login, "vs_reminders", which can only list who gets
-- reminders (name, email address, families and roles, how often) and note
-- that one was sent. It can't read any other table. Its password is set by
-- the owner (supabase/setup/15-reminders.sql) and kept only in the website's
-- settings (Vercel). A written-down exception to "no secret keys".

create table public.reminder_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  frequency text not null default 'weekly' check (frequency in ('daily', 'weekly', 'off')),
  updated_at timestamptz not null default now()
);
alter table public.reminder_preferences enable row level security;
create policy "reminder_preferences: own" on public.reminder_preferences
  for select to authenticated using (user_id = auth.uid());
create policy "reminder_preferences: own add" on public.reminder_preferences
  for insert to authenticated with check (user_id = auth.uid());
create policy "reminder_preferences: own change" on public.reminder_preferences
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create trigger reminder_preferences_log after insert or update or delete on public.reminder_preferences
  for each row execute function private.log_change();
revoke all on public.reminder_preferences from anon;

-- A record of each reminder sent (how many families and items, not what).
create table public.reminder_log (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  sent_on date not null,
  families integer not null,
  items integer not null,
  ok boolean not null,
  error text,
  created_at timestamptz not null default now()
);
create unique index reminder_log_once on public.reminder_log (user_id, sent_on) where ok;
alter table public.reminder_log enable row level security;
create policy "reminder_log: own, and system staff" on public.reminder_log
  for select to authenticated using (user_id = auth.uid() or private.is_system_staff());
-- Written only by the reminders job; never changed or removed.
revoke all on public.reminder_log from anon;

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

-- Who gets reminders: everyone with a role in an active family, unless they
-- turned reminders off.
create function reminders.recipients()
returns table (user_id uuid, email text, name text, frequency text, families jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email::text, coalesce(s.display_name, split_part(u.email, '@', 1)), coalesce(p.frequency, 'weekly'),
    jsonb_agg(jsonb_build_object('family_id', f.id, 'family_name', f.name, 'role', a.role) order by f.name)
  from public.family_access a
  join public.families f on f.id = a.family_id and f.status = 'active'
  join auth.users u on u.id = a.user_id
  left join public.staff s on s.user_id = u.id
  left join public.reminder_preferences p on p.user_id = u.id
  where u.email is not null and coalesce(p.frequency, 'weekly') <> 'off'
  group by u.id, u.email, s.display_name, p.frequency;
$$;

create function reminders.already_sent(p_user uuid, p_on date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.reminder_log l where l.user_id = p_user and l.sent_on = p_on and l.ok);
$$;

create function reminders.record_sent(p_user uuid, p_on date, p_families integer, p_items integer, p_ok boolean, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.reminder_log (user_id, sent_on, families, items, ok, error)
  values (p_user, p_on, p_families, p_items, p_ok, left(p_error, 500))
  on conflict do nothing;
$$;

revoke all on function reminders.recipients(), reminders.already_sent(uuid, date), reminders.record_sent(uuid, date, integer, integer, boolean, text) from public;
grant execute on function reminders.recipients(), reminders.already_sent(uuid, date), reminders.record_sent(uuid, date, integer, integer, boolean, text) to vs_reminders;
