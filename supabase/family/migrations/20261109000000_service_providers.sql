-- Turnstone Village Square: service providers and corporate appointments
--
-- Firms that serve the family's entities (registered agents, trust
-- companies, corporate directors and secretaries, auditors) are recorded once
-- as service providers (the outside_organisations table) and chosen wherever
-- they are appointed. Whether a provider is licensed, and its licence, are
-- recorded once on the provider, not on each appointment.
--
-- A role can also be held by one of the family's own entities, e.g. the
-- family's private trust company as trustee, or a family company as a
-- corporate director.

alter table public.outside_organisations
  add column licensed boolean not null default false,
  add column licence_number text,
  add column regulator text,
  add column contact_name text;

-- Carry over the "licensed" ticks made on appointments so far.
update public.outside_organisations o set licensed = true
where exists (select 1 from public.appointments a where a.organisation_id = o.id and a.licensed);

comment on column public.appointments.licensed is 'No longer used: whether a holder is licensed is recorded on the service provider.';

-- An appointment is held by a person, a service provider, or one of the
-- family's entities (never the entity itself).
alter table public.appointments add column holder_entity_id uuid references public.entities (id) on delete restrict;

do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.appointments'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%person_id IS NULL%organisation_id IS NULL%'
  loop
    execute format('alter table public.appointments drop constraint %I', c.conname);
  end loop;
end;
$$;
alter table public.appointments
  add constraint appointments_one_holder check (num_nonnulls(person_id, organisation_id, holder_entity_id) = 1),
  add constraint appointments_not_itself check (holder_entity_id is distinct from entity_id);

drop index public.appointments_current;
create unique index appointments_current on public.appointments
  (entity_id, role, coalesce(person_id, organisation_id, holder_entity_id)) where ceased_on is null;
create index appointments_holder_entity on public.appointments (holder_entity_id) where holder_entity_id is not null;

-- Viewers see an appointment held by a family entity only if they may see
-- that entity too.
drop policy "appointments: read" on public.appointments;
create policy "appointments: read" on public.appointments
  for select to authenticated using (
    private.can_see_entity_id(entity_id)
    and (person_id is null or private.can_see_person_id(person_id))
    and (holder_entity_id is null or private.can_see_entity_id(holder_entity_id))
  );
