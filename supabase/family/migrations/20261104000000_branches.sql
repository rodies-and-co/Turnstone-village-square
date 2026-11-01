-- Turnstone Village Square: The Branches (family database)
--
-- How branches are decided (agreed with the owner, 1 Nov 2026):
--   1. A Manager confirms who the wealth creators are. This is always asked,
--      never assumed from "Relationship to wealth".
--   2. Each child of a wealth creator may head a branch. The app asks; a
--      Manager says yes (a branch is created, named after the child) or no.
--   3. A branch head's spouse / partner and descendants are suggested for
--      that branch; a Manager confirms each one. A person is in one branch.
--
-- This file adds:
--   wealth_creators - the people confirmed as wealth creators;
--   branch_answers  - questions a Manager answered "No" to, so they aren't
--                     asked again;
-- and makes creating or renaming a branch a Manager's job (branches decide
-- what Viewers can see). Moving people between branches was already
-- Managers only (guard_person_visibility).

create table public.wealth_creators (
  person_id uuid primary key references public.people (id) on delete cascade,
  confirmed_at timestamptz not null default now(),
  confirmed_by uuid default auth.uid()
);

create table public.branch_answers (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  -- starts_branch: "Does this child of a wealth creator start a branch?"
  -- joins_branch:  "Should this person join this branch?"
  question text not null check (question in ('starts_branch', 'joins_branch')),
  branch_id uuid references public.branches (id) on delete cascade,
  answer text not null default 'no' check (answer = 'no'),
  answered_at timestamptz not null default now(),
  answered_by uuid default auth.uid(),
  check ((question = 'joins_branch') = (branch_id is not null))
);
create unique index branch_answers_once on public.branch_answers (person_id, question, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.wealth_creators enable row level security;
alter table public.branch_answers enable row level security;

-- Wealth creators: seen by anyone who may see the person; set by Managers.
create policy "wealth_creators: read" on public.wealth_creators
  for select to authenticated using (private.can_see_person_id(person_id));
create policy "wealth_creators: managers add" on public.wealth_creators
  for insert to authenticated with check (private.can_manage());
create policy "wealth_creators: managers remove" on public.wealth_creators
  for delete to authenticated using (private.can_manage());

-- Answers: seen by Managers and Administrators; given and withdrawn by Managers.
create policy "branch_answers: read" on public.branch_answers
  for select to authenticated using (private.can_edit());
create policy "branch_answers: managers add" on public.branch_answers
  for insert to authenticated with check (private.can_manage());
create policy "branch_answers: managers remove" on public.branch_answers
  for delete to authenticated using (private.can_manage());

-- Branches: only Managers create or rename them now.
drop policy "branches: editors add" on public.branches;
drop policy "branches: editors change" on public.branches;
create policy "branches: managers add" on public.branches
  for insert to authenticated with check (private.can_manage());
create policy "branches: managers change" on public.branches
  for update to authenticated using (private.can_manage()) with check (private.can_manage());

create trigger wealth_creators_log after insert or update or delete on public.wealth_creators
  for each row execute function private.log_change();
create trigger branch_answers_log after insert or update or delete on public.branch_answers
  for each row execute function private.log_change();
