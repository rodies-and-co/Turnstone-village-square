-- Turnstone Village Square: authorised share capital in the Entity Standards (hub)
--
-- Not every kind of company has an authorised share capital (a maximum
-- number of shares set in its constitution). A new field says, per standard:
--   required  – the constitution must set the maximum (e.g. South Africa
--               Pty/Ltd/Inc under the MOI; Isle of Man 1931 Act companies);
--   optional  – not required, but the constitution may set one (e.g. Isle of
--               Man 2006 Act companies, UK companies since 2009, BVI business
--               companies, Mauritius companies);
--   none      – no shares at all (NPCs, close corporations, LLCs,
--               partnerships, trusts, foundations).
-- When a share class is added, the maximum is only asked for when it is
-- required, and can be added when it is optional.
--
-- The starting values below are set by Turnstone with this file, as the
-- original standards were. Each is listed under "to confirm" until checked
-- by hand or with a local adviser.

alter table public.entity_standards
  add column authorised_capital text not null default 'none' check (authorised_capital in ('required', 'optional', 'none'));

update public.entity_standards set authorised_capital = 'required'
where (jurisdiction, sub_type) in (
  ('South Africa', 'Private company (Pty) Ltd'),
  ('South Africa', 'Public company Ltd'),
  ('South Africa', 'Personal liability company Inc'),
  ('Isle of Man', '1931 Act company')
);
update public.entity_standards set authorised_capital = 'optional'
where (jurisdiction, sub_type) in (
  ('Isle of Man', '2006 Act company'),
  ('United Kingdom', 'Private company limited by shares'),
  ('United Kingdom', 'Public limited company plc'),
  ('British Virgin Islands', 'BVI Business Company'),
  ('Mauritius', 'Domestic private company'),
  ('Mauritius', 'Global Business Licence company'),
  ('Mauritius', 'Authorised Company')
);
-- Any other company standard (e.g. drafts made since) keeps the safe choice:
-- not required, but may be set.
update public.entity_standards set authorised_capital = 'optional'
where entity_type in ('company', 'llc') and share_capital <> 'none' and authorised_capital = 'none'
  and (jurisdiction, sub_type) not in (('Isle of Man', 'Limited liability company'));

update public.entity_standards
set to_confirm = coalesce(to_confirm || E'\n', '') || 'Authorised share capital: confirm whether the constitution must set a maximum number of shares (set to "'
  || case authorised_capital when 'required' then 'required' when 'optional' then 'not required, may be set' else 'none' end || '").'
where authorised_capital <> 'none';

-- New drafts copy the field from the closest standard; with no standard to
-- copy from, the general minimum is "none".
create or replace function private.entity_standard_rules()
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
      new.min_designated_members := 0; new.identity_verification_required := false; new.share_capital := 'none'; new.authorised_capital := 'none';
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
