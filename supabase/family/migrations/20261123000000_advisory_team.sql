-- Circles of advisors, as an advisory team map (the owner, 5 Nov 2026:
-- "replicate and improve" The Family Square's Advisory team).
--
-- - Each place in a circle (the family's, or a branch's) can now say which of
--   the ten domains of family wealth it covers. What they advise on, in
--   words, becomes optional when a domain is given.
-- - One advisor in each circle can coordinate the others.
-- - The team (Managers and Administrators) records how each relationship is
--   working. That is an internal view, so it is kept apart and only the team
--   sees it.

alter table public.advisor_roles alter column advises_on drop not null;
alter table public.advisor_roles add column domain text
  check (domain is null or domain in ('financial', 'investment', 'estate_legal', 'philanthropy', 'risk', 'governance', 'leadership', 'learning', 'dynamics', 'health'));
alter table public.advisor_roles add constraint advisor_roles_says_what check (domain is not null or advises_on is not null);
alter table public.advisor_roles add column coordinator boolean not null default false;
-- One current coordinator per circle.
create unique index advisor_roles_one_coordinator on public.advisor_roles
  (coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) where coordinator and to_date is null;
-- The same advisor isn't placed twice for the same domain in the same circle.
create unique index advisor_roles_once on public.advisor_roles
  (advisor_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), domain) where domain is not null and to_date is null;

-- Who an advisor serves can't be moved to another circle (that changes who
-- sees it): end the place and add a new one.
create function private.advisor_role_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.advisor_id <> old.advisor_id or new.branch_id is distinct from old.branch_id then
    raise exception 'Advisors: a place in a circle can''t be moved to another advisor or circle. End it and add a new one.';
  end if;
  if new.to_date is not null and new.to_date > (now() at time zone 'Europe/London')::date then
    raise exception 'Advisors: a place in a circle can''t end on a future date.';
  end if;
  if new.to_date is not null then
    new.coordinator := false;
  end if;
  return new;
end;
$$;
create trigger advisor_roles_rules before update on public.advisor_roles
  for each row execute function private.advisor_role_rules();
revoke all on function private.advisor_role_rules() from public;

create table public.advisor_assessments (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null unique references public.advisor_roles (id) on delete cascade,
  relationship text not null default 'working' check (relationship in ('strong', 'working', 'weak')),
  note text,
  assessed_by uuid,
  assessed_on date not null default (now() at time zone 'Europe/London')::date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function private.advisor_assessment_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.role_id <> old.role_id then
    raise exception 'Advisors: an assessment can''t be moved to another place in a circle.';
  end if;
  new.assessed_by := coalesce(auth.uid(), new.assessed_by);
  new.assessed_on := (now() at time zone 'Europe/London')::date;
  return new;
end;
$$;
create trigger advisor_assessments_rules before insert or update on public.advisor_assessments
  for each row execute function private.advisor_assessment_rules();
revoke all on function private.advisor_assessment_rules() from public;

alter table public.advisor_assessments enable row level security;
create policy "advisor_assessments: editors read" on public.advisor_assessments
  for select to authenticated using (private.can_edit());
create policy "advisor_assessments: editors add" on public.advisor_assessments
  for insert to authenticated with check (private.can_edit());
create policy "advisor_assessments: editors change" on public.advisor_assessments
  for update to authenticated using (private.can_edit()) with check (private.can_edit());
-- No delete rule: it goes with its place in a circle (removed by two people).
create trigger advisor_assessments_log after insert or update or delete on public.advisor_assessments
  for each row execute function private.log_change();
create trigger advisor_assessments_updated_at before update on public.advisor_assessments
  for each row execute function private.touch_updated_at();
revoke all on public.advisor_assessments from anon;
