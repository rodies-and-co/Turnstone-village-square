-- Village Square: the log of questions put to Ask the Elder.
--
-- The owner's choices (5 Nov 2026): the Elder answers questions about the
-- family's records (only what the person asking may already see) and gives
-- general guidance on family governance and succession; everyone with a
-- login may use it. AI is Claude only, through Turnstone's own account; the
-- AI must not learn from the data, and personal details are replaced with
-- placeholders before anything is sent and restored on return (CLAUDE.md).
--
-- The answer is recorded by the app on behalf of the person who asked (with
-- their own sign-in), straight after Claude replies.
--
-- Each question and answer is kept here, in the family's own database (in
-- the UK), as a record of what was asked and answered. Only the placeholder
-- version ever leaves it. A person sees their own questions; Managers see all
-- of them, so the use of AI can be checked. Entries can't be changed or
-- removed.

create table public.elder_questions (
  id uuid primary key default gen_random_uuid(),
  asked_by uuid not null default auth.uid(),
  question text not null check (length(trim(question)) between 1 and 2000),
  answer text,
  failed boolean not null default false,
  model text,
  input_tokens integer,
  output_tokens integer,
  -- How many personal details were replaced with placeholders before sending.
  placeholders integer not null default 0,
  created_at timestamptz not null default now()
);
create index elder_questions_by on public.elder_questions (asked_by, created_at desc);

-- A fair limit per person, so the family's Claude account isn't used up by
-- one person. Entries can't be changed, except that the answer is filled in
-- once, by the person who asked, straight after (record_elder_answer()).
create function private.elder_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.asked_by := auth.uid();
    end if;
    new.created_at := now();
    -- The answer is only ever recorded afterwards, by record_elder_answer().
    new.answer := null;
    new.failed := false;
    new.model := null;
    new.input_tokens := null;
    new.output_tokens := null;
    new.placeholders := 0;
    if auth.uid() is not null and (
      select count(*) from public.elder_questions q
      where q.asked_by = auth.uid() and q.created_at > now() - interval '1 day') >= 50 then
      raise exception 'Elder: you have asked 50 questions in the last day. Please try again tomorrow.';
    end if;
    return new;
  end if;
  if current_setting('vs.answering', true) = 'on' and old.answer is null and not old.failed
     and new.question = old.question and new.asked_by = old.asked_by and new.created_at = old.created_at then
    return new;
  end if;
  raise exception 'Elder: questions and answers are kept as a record and can''t be changed.';
end;
$$;
create function public.record_elder_answer(p_id uuid, p_answer text, p_failed boolean, p_model text, p_in integer, p_out integer, p_placeholders integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('vs.answering', 'on', true);
  update public.elder_questions set answer = left(p_answer, 20000), failed = coalesce(p_failed, false), model = left(p_model, 100),
    input_tokens = p_in, output_tokens = p_out, placeholders = coalesce(p_placeholders, 0)
  where id = p_id and asked_by = auth.uid() and answer is null and not failed
    and created_at > now() - interval '10 minutes';
  perform set_config('vs.answering', 'off', true);
end;
$$;
create trigger elder_questions_rules before insert or update on public.elder_questions
  for each row execute function private.elder_rules();

alter table public.elder_questions enable row level security;
create policy "elder_questions: own, and Managers see all" on public.elder_questions
  for select to authenticated using (
    private.my_role() is not null and (asked_by = auth.uid() or private.can_manage())
  );
create policy "elder_questions: anyone with a role asks" on public.elder_questions
  for insert to authenticated with check (private.my_role() is not null and asked_by = auth.uid());
-- No update or delete rules: the answer is recorded through record_elder_answer().
create trigger elder_questions_log after insert or update or delete on public.elder_questions
  for each row execute function private.log_change();
revoke all on public.elder_questions from anon;

revoke all on function private.elder_rules() from public;
revoke all on function public.record_elder_answer(uuid, text, boolean, text, integer, integer, integer) from public, anon;
grant execute on function public.record_elder_answer(uuid, text, boolean, text, integer, integer, integer) to authenticated;
