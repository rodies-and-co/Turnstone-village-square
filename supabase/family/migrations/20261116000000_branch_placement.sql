-- Turnstone Village Square: only Managers place a person in a branch
-- (family database)
--
-- The owner (2 Nov 2026): only Managers and the Super User place a person in
-- a branch, including a new person. (The System Admin sees no family
-- records.) A branch decides what Viewers see, so it is access management.
-- An Administrator adds a new person without a branch; a Manager then places
-- them.

create or replace function private.guard_person_visibility()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null or private.can_manage() then
    return new;
  end if;
  if tg_op = 'INSERT' and new.user_id is not null then
    raise exception 'Only a Manager can link a person to a login';
  end if;
  if tg_op = 'INSERT' and new.branch_id is not null then
    raise exception 'Only a Manager can place a person in a branch. Add them without a branch; a Manager then places them.';
  end if;
  if tg_op = 'UPDATE' and (
    new.user_id is distinct from old.user_id
    or new.branch_id is distinct from old.branch_id
  ) then
    raise exception 'Only a Manager can move a person to another branch or change their login link';
  end if;
  return new;
end;
$$;
