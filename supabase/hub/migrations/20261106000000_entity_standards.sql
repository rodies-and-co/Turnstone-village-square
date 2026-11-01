-- Turnstone Village Square: Entity Standards (hub)
--
-- An Entity Standard holds the statutory rules for one kind of entity in one
-- jurisdiction (e.g. "South Africa – Private company (Pty) Ltd"): the officers
-- it must have, its registers, its filings and deadlines, and its beneficial
-- ownership (BO) rule. Standards live here in the hub and are shared by every
-- family. Families never keep their own copies.
--
-- Who may do what:
--   - anyone signed in may read them (they are not family records);
--   - a Manager or Administrator of a family may add a DRAFT standard (the
--     new-entity rule: a new jurisdiction / type pair gets a draft for review);
--   - only the Super User and the System Admin change or approve standards.
-- Approving records who approved it and when. A standard is never deleted:
-- it is retired, so past records keep the rules that applied at the time.

create table public.entity_standards (
  id uuid primary key default gen_random_uuid(),
  jurisdiction text not null check (length(trim(jurisdiction)) > 0),
  entity_type text not null check (entity_type in ('company', 'trust', 'foundation', 'llc', 'partnership')),
  sub_type text not null check (length(trim(sub_type)) > 0),
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  version integer not null default 1 check (version > 0),
  effective_from date,
  statute text,

  -- Officers and roles: the setup checklist reads these.
  min_directors integer not null default 0 check (min_directors >= 0),
  min_resident_directors integer not null default 0 check (min_resident_directors >= 0),
  secretary_required boolean not null default false,
  registered_office_required boolean not null default true,
  registered_agent_required boolean not null default false,
  nominated_officer_required boolean not null default false,
  management_company_required boolean not null default false,
  public_officer_required boolean not null default false,
  auditor_required boolean not null default false,
  accounting_officer_required boolean not null default false,
  min_trustees integer not null default 0 check (min_trustees >= 0),
  licensed_trustee_required boolean not null default false,
  min_council_members integer not null default 0 check (min_council_members >= 0),
  min_resident_council_members integer not null default 0 check (min_resident_council_members >= 0),
  enforcer_required boolean not null default false,
  min_designated_members integer not null default 0 check (min_designated_members >= 0),
  identity_verification_required boolean not null default false,
  share_capital text not null default 'none' check (share_capital in ('required', 'optional', 'none')),

  -- Beneficial ownership and reporting.
  bo_threshold_percent numeric(5, 2) check (bo_threshold_percent is null or (bo_threshold_percent > 0 and bo_threshold_percent <= 100)),
  bo_rule text not null default 'at_least' check (bo_rule in ('more_than', 'at_least', 'everyone')),
  bo_change_deadline text,
  registry_notice text,
  agm text,
  record_retention_years integer check (record_retention_years is null or record_retention_years > 0),
  review_months integer not null default 12 check (review_months > 0),

  -- Plain-English detail, for people to read.
  officers_notes text,
  registers text,
  filings text,
  event_deadlines text,
  to_confirm text,
  sources jsonb not null default '[]'::jsonb,
  last_legal_check date,

  based_on uuid references public.entity_standards (id),
  created_by uuid default auth.uid(),
  created_for_family uuid references public.families (id) on delete set null,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'approved') = (effective_from is not null) or status = 'retired')
);
create unique index entity_standards_version on public.entity_standards (lower(jurisdiction), entity_type, lower(sub_type), version);

-- May the signed-in user propose a draft standard? Managers and
-- Administrators of a family (with two-factor), and system staff.
create function private.can_propose_standard()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_system_staff() or exists (
    select 1 from public.family_access a
    where a.user_id = auth.uid() and a.role in ('manager', 'administrator') and private.has_aal2()
  );
$$;

create function private.can_approve_standard()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(private.my_system_role() in ('super_user', 'system_admin'), false);
$$;

revoke all on function private.can_propose_standard(), private.can_approve_standard() from public;
grant execute on function private.can_propose_standard(), private.can_approve_standard() to authenticated;

-- Approval stamps who and when; nobody sets these by hand.
--
-- A draft proposed by a family (not by the Super User or System Admin) is
-- built here, not from what was sent: only the jurisdiction, type and
-- sub-type are taken. Its rules are copied from the closest standard
-- (based_on: the same jurisdiction and type, if one exists), its version
-- follows any earlier versions, and no family is named, because the hub
-- holds no family records.
create function private.entity_standard_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  src public.entity_standards;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is null then
      return new; -- set-up scripts run by the database owner
    end if;
    new.created_by := auth.uid();
    if private.can_approve_standard() then
      if new.status = 'approved' then
        new.reviewed_by := auth.uid();
        new.reviewed_at := now();
        new.effective_from := coalesce(new.effective_from, current_date);
      else
        new.reviewed_by := null;
        new.reviewed_at := null;
      end if;
      return new;
    end if;

    if new.status <> 'draft' then
      raise exception 'Entity Standard: a new standard starts as a draft. The Super User or System Admin approves it.';
    end if;
    select * into src from public.entity_standards s
    where lower(s.jurisdiction) = lower(new.jurisdiction) and s.entity_type = new.entity_type and s.status <> 'retired'
    order by (s.status = 'approved') desc, s.version desc
    limit 1;
    new := jsonb_populate_record(
      new,
      case when src.id is null then '{}'::jsonb
      else (to_jsonb(src) - array['id', 'jurisdiction', 'entity_type', 'sub_type', 'name', 'status', 'version', 'effective_from',
        'officers_notes', 'registers', 'filings', 'event_deadlines', 'to_confirm', 'sources', 'last_legal_check', 'statute',
        'based_on', 'created_by', 'created_for_family', 'reviewed_by', 'reviewed_at', 'review_note', 'created_at', 'updated_at'])
      end
    );
    if src.id is null then
      -- No standard for this jurisdiction and type: the general minimums.
      new.min_directors := 0; new.min_resident_directors := 0; new.secretary_required := false;
      new.registered_office_required := true; new.registered_agent_required := false; new.nominated_officer_required := false;
      new.management_company_required := false; new.public_officer_required := false; new.auditor_required := false;
      new.accounting_officer_required := false; new.min_trustees := 0; new.licensed_trustee_required := false;
      new.min_council_members := 0; new.min_resident_council_members := 0; new.enforcer_required := false;
      new.min_designated_members := 0; new.identity_verification_required := false; new.share_capital := 'none';
      new.bo_threshold_percent := null; new.bo_rule := 'at_least'; new.bo_change_deadline := null; new.registry_notice := null;
      new.agm := null; new.record_retention_years := null; new.review_months := 12;
    end if;
    new.name := trim(new.jurisdiction) || ' – ' || trim(new.sub_type);
    new.version := coalesce((select max(s.version) from public.entity_standards s
      where lower(s.jurisdiction) = lower(new.jurisdiction) and s.entity_type = new.entity_type and lower(s.sub_type) = lower(new.sub_type)), 0) + 1;
    new.effective_from := null;
    new.statute := null; new.officers_notes := null; new.registers := null; new.filings := null;
    new.event_deadlines := null; new.to_confirm := null; new.sources := '[]'::jsonb; new.last_legal_check := null;
    new.based_on := src.id;
    new.created_for_family := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.review_note := case when src.id is null
      then 'Created automatically when an entity of this kind was added, with the general minimums only. Needs review: confirm the statutory requirements, filings and deadlines, with sources.'
      else 'Created automatically when an entity of this kind was added. Copied from “' || src.name || '”. Needs review: confirm the statutory requirements, filings and deadlines, with sources.'
    end;
    return new;
  end if;

  new.updated_at := now();
  if auth.uid() is null then
    return new;
  end if;
  new.created_by := old.created_by;
  new.created_for_family := old.created_for_family;
  new.reviewed_by := old.reviewed_by;
  new.reviewed_at := old.reviewed_at;
  if new.status = 'approved' and old.status <> 'approved' then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
    new.effective_from := coalesce(new.effective_from, current_date);
  end if;
  return new;
end;
$$;
revoke all on function private.entity_standard_rules() from public;

-- When a new version is approved, the earlier approved versions of the same
-- standard are retired. They stay on record for the entities set up under them.
create function private.retire_earlier_versions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status <> 'approved') then
    update public.entity_standards s set status = 'retired'
    where s.id <> new.id and s.status = 'approved'
      and lower(s.jurisdiction) = lower(new.jurisdiction) and s.entity_type = new.entity_type
      and lower(s.sub_type) = lower(new.sub_type) and s.version < new.version;
  end if;
  return new;
end;
$$;
revoke all on function private.retire_earlier_versions() from public;

create trigger entity_standards_retire_earlier after insert or update of status on public.entity_standards
  for each row execute function private.retire_earlier_versions();

create trigger entity_standards_rules before insert or update on public.entity_standards
  for each row execute function private.entity_standard_rules();

alter table public.entity_standards enable row level security;

create policy "entity_standards: anyone signed in reads" on public.entity_standards
  for select to authenticated using (true);
create policy "entity_standards: propose a draft" on public.entity_standards
  for insert to authenticated with check (private.can_approve_standard() or (private.can_propose_standard() and status = 'draft'));
create policy "entity_standards: super user and system admin change" on public.entity_standards
  for update to authenticated using (private.can_approve_standard()) with check (private.can_approve_standard());
-- No delete policy: standards are retired, never deleted.

create trigger entity_standards_log after insert or update or delete on public.entity_standards
  for each row execute function private.log_change();

-- Visitors who aren't signed in get nothing, as for every hub table.
revoke all on public.entity_standards from anon;
