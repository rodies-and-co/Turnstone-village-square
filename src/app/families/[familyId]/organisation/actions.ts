"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { APPOINTMENT_ROLES, ENTITY_TYPES, closestStandard, matchStandard } from "@/lib/entity-checklist";
import { getFamilyContext } from "@/lib/family-context";
import { isDate, oneOf } from "@/lib/governance";
import type { SavedCode } from "@/lib/messages";
import { parseBasis } from "@/lib/meetings";
import { askToRemove } from "@/lib/removal";
import { addressMatchKey, friendlyError, parseAddress } from "@/lib/people";
import { REQUIRED_APPOINTEES } from "@/lib/providers";
import { REQUIREMENT_FIELDS, type EntityStandard } from "@/lib/standards";

// The Organisation. Managers and Administrators add and change; only
// Managers remove. The family database checks this too.

const ORG_KINDS = [
  "trust_company",
  "registered_agent",
  "corporate_services",
  "management_company",
  "law_firm",
  "accounting_firm",
  "bank",
  "company",
  "other",
] as const;

function go(path: string, error?: string, saved: SavedCode = "saved"): never {
  revalidatePath(path.split("?")[0], "layout");
  const params = new URLSearchParams(error ? { error } : { saved });
  redirect(`${path}${path.includes("?") ? "&" : "?"}${params.toString()}`);
}

function text(form: FormData, name: string) {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}
const optional = (form: FormData, name: string) => text(form, name) || null;

function orgError(message: string | undefined) {
  const m = message ?? "";
  if (/entities_name/.test(m)) return "There is already an entity with that name.";
  if (/outside_organisations_name/.test(m)) return "There is already an outside organisation with that name. Choose it from the list instead.";
  if (/appointments_current/.test(m)) return "They already hold that role.";
  if (/appointments_not_itself/.test(m)) return "An entity can't hold a role in itself.";
  if (/foreign key/.test(m) && /share_transactions|settlements|beneficiar/.test(m))
    return "This entity holds shares in, settled, or benefits from another of the family's entities. Those are kept as records, so it can't be removed.";
  if (/base_currency/.test(m)) return "The currency should be three capital letters, e.g. GBP.";
  if (/^Appointments: /.test(m)) return m.replace(/^Appointments: /, "");
  return friendlyError(m);
}

// Shared by create and update: the editable details.
function details(form: FormData) {
  const day = text(form, "year_end_day");
  const month = text(form, "year_end_month");
  const registeredOn = text(form, "registered_on");
  const complianceFrom = text(form, "compliance_from");
  const status = text(form, "status") || "active";
  if ((day && !month) || (!day && month)) return { error: "Please give both the day and the month of the year end, or neither." };
  if (day && month) {
    const d = new Date(Date.UTC(2024, Number(month) - 1, Number(day))); // 2024: allows 29 February
    if (d.getUTCMonth() !== Number(month) - 1) return { error: "That year end date doesn't exist." };
  }
  if (registeredOn && !isDate(registeredOn)) return { error: "Please enter the date as day, month and year." };
  if (complianceFrom && !isDate(complianceFrom)) return { error: "Please enter the date as day, month and year." };
  const currency = text(form, "base_currency").toUpperCase() || null;
  if (currency && !/^[A-Z]{3}$/.test(currency)) return { error: "The currency should be three letters, e.g. GBP." };
  if (!["active", "dormant", "dissolved"].includes(status)) return { error: "Please choose the status from the list." };
  return {
    value: {
      name: text(form, "name"),
      registration_number: optional(form, "registration_number"),
      registered_on: registeredOn || null,
      compliance_from: complianceFrom || null,
      activity: optional(form, "activity"),
      year_end_day: day ? Number(day) : null,
      year_end_month: month ? Number(month) : null,
      base_currency: currency,
      family_contact_id: optional(form, "family_contact_id"),
      branch_id: optional(form, "branch_id"),
      status,
    },
  };
}

// ---------------------------------------------------------------------------
// Entities

export async function createEntity(familyId: string, form: FormData) {
  const back = `/families/${familyId}/organisation/new`;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db || !ctx.canEdit) go(back, "You don't have permission to add entities.");

  const entityType = text(form, "entity_type");
  const jurisdiction = text(form, "jurisdiction");
  const subType = text(form, "sub_type");
  if (!oneOf(entityType, ENTITY_TYPES)) go(back, "Please choose the kind of entity.");
  if (!jurisdiction) go(back, "Please choose the jurisdiction.");
  if (!subType) go(back, "Please choose or type the type of entity.");
  const d = details(form);
  if ("error" in d) go(back, d.error);
  if (!d.value.name) go(back, "Please give the entity a name.");

  // Names are unique: check before anything is created in the hub.
  const { data: sameName } = await ctx.db.from("entities").select("id").ilike("name", d.value.name.replace(/[%_\\]/g, "\\$&")).limit(1);
  if (sameName?.length) go(back, "There is already an entity with that name.");

  // Find its Entity Standard in the hub; if there is none, add a draft for
  // review (the new-entity rule). For a family's Manager or Administrator the
  // hub builds the draft itself, copied from the closest standard; for the
  // Super User or System Admin the copy is made here.
  const { data: all } = await ctx.supabase.from("entity_standards").select("*");
  const standards = (all ?? []) as EntityStandard[];
  let standard = matchStandard(standards, { jurisdiction, entity_type: entityType, sub_type: subType });
  let newDraft = false;
  if (!standard) {
    const closest = closestStandard(standards, { jurisdiction, entity_type: entityType });
    const copied = closest ? Object.fromEntries(REQUIREMENT_FIELDS.map((f) => [f, closest[f]])) : {};
    const same = standards.filter(
      (x) => x.jurisdiction.toLowerCase() === jurisdiction.toLowerCase() && x.entity_type === entityType && x.sub_type.toLowerCase() === subType.toLowerCase(),
    );
    const { data: created, error } = await ctx.supabase
      .from("entity_standards")
      .insert({
        ...copied,
        jurisdiction,
        entity_type: entityType,
        sub_type: subType,
        name: `${jurisdiction} – ${subType}`,
        status: "draft",
        version: Math.max(0, ...same.map((x) => x.version)) + 1,
        based_on: closest?.id ?? null,
        review_note: closest
          ? `Created automatically when an entity of this kind was added. Copied from “${closest.name}”. Needs review: confirm the statutory requirements, filings and deadlines, with sources.`
          : "Created automatically when an entity of this kind was added, with the general minimums only. Needs review: confirm the statutory requirements, filings and deadlines, with sources.",
      })
      .select("*")
      .single();
    if (error || !created) go(back, `The Entity Standard for this kind of entity couldn't be created: ${friendlyError(error?.message)}`);
    standard = created as EntityStandard;
    newDraft = true;
  }

  // The corporate roles its standard requires from the start (e.g. an Isle
  // of Man 2006 Act company's registered agent): checked before anything is saved.
  // (Not for a kind of entity that has only just been given a draft
  // standard: the form couldn't ask, so they are added afterwards.)
  const needs = newDraft ? [] : REQUIRED_APPOINTEES.filter((r) => (standard as unknown as Record<string, unknown>)[r.flag]);
  for (const r of needs) {
    const choice = text(form, `appoint_${r.role}`);
    const what = r.label.toLowerCase();
    if (!choice) go(back, `Please choose the ${what}. It is required for this kind of entity.`);
    if (choice === "new") {
      const newName = text(form, `appoint_${r.role}_name`);
      if (!newName) go(back, `Please type the new ${what}'s name.`);
      const { data: clash } = await ctx.db.from("outside_organisations").select("id").ilike("name", newName.replace(/[%_\\]/g, "\\$&")).limit(1);
      if (clash?.length) go(back, `There is already a service provider called “${newName}”. Choose it from the list instead.`);
      if (r.licensed && form.get(`appoint_${r.role}_licensed`) !== "on") go(back, `The ${what} must be licensed: tick “Licensed” for the new provider.`);
    } else if (choice.startsWith("organisation:")) {
      const { data: p } = await ctx.db.from("outside_organisations").select("name, licensed").eq("id", choice.slice(13)).maybeSingle();
      if (!p) go(back, `That ${what} couldn't be found. Please choose again.`);
      if (r.licensed && !p.licensed) go(back, `${p.name} isn't recorded as licensed. Record its licence on the Service providers page, or choose another.`);
    } else if (!(choice.startsWith("entity:") && r.allowEntity)) {
      go(back, `Please choose the ${what} again.`);
    }
  }

  const { data: entity, error } = await ctx.db
    .from("entities")
    .insert({ ...d.value, entity_type: entityType, jurisdiction, sub_type: subType, standard_id: standard.id })
    .select("id")
    .single();
  if (error || !entity) go(back, orgError(error?.message));

  const problems: string[] = [];
  for (const r of needs) {
    const choice = text(form, `appoint_${r.role}`);
    let organisationId: string | null = null;
    let holderEntityId: string | null = null;
    if (choice === "new") {
      const made = await newProvider(ctx, form, `appoint_${r.role}_`, r.kind);
      if ("error" in made) {
        problems.push(`${r.label}: ${made.error}`);
        continue;
      }
      organisationId = made.id;
    } else if (choice.startsWith("organisation:")) organisationId = choice.slice(13);
    else if (choice.startsWith("entity:") && r.allowEntity) holderEntityId = choice.slice(7);
    else {
      problems.push(`${r.label}: please choose again.`);
      continue;
    }
    const { error: e } = await ctx.db
      .from("appointments")
      // Named when the entity was formed.
      .insert({ entity_id: entity.id, role: r.role, organisation_id: organisationId, holder_entity_id: holderEntityId, appointed_on: d.value.registered_on, basis: "formation" });
    if (e) problems.push(`${r.label}: ${orgError(e.message)}`);
  }
  if (problems.length) go(`/families/${familyId}/organisation/${entity.id}?tab=officers`, `The entity was added, but not every appointment: ${problems.join(" ")}`);
  go(`/families/${familyId}/organisation/${entity.id}`, undefined, newDraft ? "entity_added_new_standard" : "entity_added");
}

export async function updateEntity(familyId: string, entityId: string, form: FormData) {
  const back = `/families/${familyId}/organisation/${entityId}`;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db || !ctx.canEdit) go(back, "You don't have permission to change this entity.");
  const d = details(form);
  if ("error" in d) go(back, d.error);
  if (!d.value.name) go(back, "Please give the entity a name.");
  const dissolvedOn = text(form, "dissolved_on");
  if (dissolvedOn && !isDate(dissolvedOn)) go(back, "Please enter the date as day, month and year.");
  const { error } = await ctx.db
    .from("entities")
    .update({ ...d.value, dissolved_on: d.value.status === "dissolved" ? dissolvedOn || null : null })
    .eq("id", entityId);
  go(back, error ? orgError(error.message) : undefined, "entity_saved");
}

// Registered office: an address the family already has, or a new one (a new
// address that matches an existing one is reused, so it is never stored twice).
export async function setRegisteredOffice(familyId: string, entityId: string, form: FormData) {
  const back = `/families/${familyId}/organisation/${entityId}`;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db || !ctx.canEdit) go(back, "You don't have permission to change this entity.");
  let addressId = text(form, "address_id");
  if (!addressId) {
    const parsed = parseAddress(form);
    if (!parsed.ok) go(back, parsed.error);
    const { data: existing } = await ctx.db.from("addresses").select("id").eq("match_key", addressMatchKey(parsed.value)).maybeSingle();
    if (existing) addressId = existing.id;
    else {
      const { data, error } = await ctx.db.from("addresses").insert(parsed.value).select("id").single();
      if (error || !data) go(back, friendlyError(error?.message));
      addressId = data.id;
    }
  }
  const { error } = await ctx.db.from("entities").update({ registered_address_id: addressId }).eq("id", entityId);
  go(back, error ? orgError(error.message) : undefined, "office_saved");
}

export async function removeEntity(familyId: string, entityId: string) {
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, "entities", entityId);
  go(`/families/${familyId}/organisation/${entityId}`, error ?? undefined, "removal_requested");
}

// ---------------------------------------------------------------------------
// Officers and appointments

// A new service provider typed into a form (fields `<prefix>name`,
// `<prefix>kind`, `<prefix>jurisdiction`, `<prefix>licensed`,
// `<prefix>licence_number`). Returns its id, or an error.
async function newProvider(ctx: Awaited<ReturnType<typeof getFamilyContext>>, form: FormData, prefix: string, defaultKind = "other") {
  const name = text(form, `${prefix}name`);
  const kind = text(form, `${prefix}kind`) || defaultKind;
  if (!name) return { error: "Please choose the service provider, or type the new provider's name." };
  if (!(ORG_KINDS as readonly string[]).includes(kind)) return { error: "Please choose what kind of provider it is." };
  const { data, error } = await ctx
    .db!.from("outside_organisations")
    .insert({
      name,
      kind,
      jurisdiction: optional(form, `${prefix}jurisdiction`),
      licensed: form.get(`${prefix}licensed`) === "on",
      licence_number: optional(form, `${prefix}licence_number`),
    })
    .select("id")
    .single();
  if (error || !data) return { error: orgError(error?.message) };
  return { id: data.id as string };
}

export async function addAppointment(familyId: string, entityId: string, form: FormData) {
  const back = `/families/${familyId}/organisation/${entityId}?tab=officers`;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db || !ctx.canEdit) go(back, "You don't have permission to change this entity.");
  const db = ctx.db;
  const role = text(form, "role");
  const holder = text(form, "holder");
  const appointedOn = text(form, "appointed_on");
  if (!oneOf(role, APPOINTMENT_ROLES)) go(back, "Please choose the role.");
  if (appointedOn && !isDate(appointedOn)) go(back, "Please enter the date as day, month and year.");
  // What it was decided by, checked before anything (such as a new provider) is saved.
  const basis = parseBasis(text(form, "basis_choice"), text(form, "basis_note"));
  if ("error" in basis) go(back, basis.error);

  let personId: string | null = null;
  let organisationId: string | null = null;
  let holderEntityId: string | null = null;
  if (holder === "person") {
    personId = text(form, "person_id");
    if (!personId) go(back, "Please choose the person. Add them to the Tree first if they aren't there.");
  } else if (holder === "organisation") {
    organisationId = text(form, "organisation_id");
    if (!organisationId) {
      const made = await newProvider(ctx, form, "organisation_");
      if ("error" in made) go(back, made.error);
      organisationId = made.id;
    }
  } else if (holder === "entity") {
    holderEntityId = text(form, "holder_entity_id");
    if (!holderEntityId) go(back, "Please choose which of the family's entities holds the role.");
    if (holderEntityId === entityId) go(back, "An entity can't hold a role in itself.");
  } else {
    go(back, "Please say who holds the role.");
  }

  const { error } = await db.from("appointments").insert({
    entity_id: entityId,
    role,
    person_id: personId,
    organisation_id: organisationId,
    holder_entity_id: holderEntityId,
    appointed_on: appointedOn || null,
    resident: form.get("resident") === "on",
    identity_verified: holder === "person" && form.get("identity_verified") === "on",
    notes: optional(form, "notes"),
    ...basis,
  });
  go(back, error ? orgError(error.message) : undefined, "appointment_added");
}

// Ending an appointment keeps it in the history.
export async function endAppointment(familyId: string, entityId: string, appointmentId: string, form: FormData) {
  const back = `/families/${familyId}/organisation/${entityId}?tab=officers`;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db || !ctx.canEdit) go(back, "You don't have permission to change this entity.");
  const endedOn = String(form.get("ended_on") ?? "").trim();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  if (!isDate(endedOn)) go(back, "Please give the date it ended.");
  if (endedOn > today) go(back, "The date it ended can't be in the future.");
  const { data, error } = await ctx.db
    .from("appointments")
    .update({ ceased_on: endedOn })
    .eq("id", appointmentId)
    .eq("entity_id", entityId)
    .is("ceased_on", null)
    .select("id");
  if (error && /check constraint/.test(error.message)) go(back, "The date it ended can't be before the date of appointment.");
  if (!error && !data?.length) go(back, "That appointment has already ended, or couldn't be found. Please look again.");
  go(back, error ? orgError(error.message) : undefined, "appointment_ended");
}

export async function removeAppointment(familyId: string, entityId: string, appointmentId: string) {
  const back = `/families/${familyId}/organisation/${entityId}?tab=officers`;
  const ctx = await getFamilyContext(familyId);
  const error = await askToRemove(ctx, "appointments", appointmentId, { entity_id: entityId });
  go(back, error ?? undefined, "removal_requested");
}
