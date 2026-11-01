"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { APPOINTMENT_ROLES, ENTITY_TYPES, closestStandard, matchStandard } from "@/lib/entity-checklist";
import { getFamilyContext } from "@/lib/family-context";
import { isDate, oneOf } from "@/lib/governance";
import type { SavedCode } from "@/lib/messages";
import { addressMatchKey, friendlyError, parseAddress } from "@/lib/people";
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
  if (/foreign key/.test(m) && /share_transactions|settlements|beneficiar/.test(m))
    return "This entity holds shares in, settled, or benefits from another of the family's entities. Those are kept as records, so it can't be removed.";
  if (/base_currency/.test(m)) return "The currency should be three capital letters, e.g. GBP.";
  return friendlyError(m);
}

// Shared by create and update: the editable details.
function details(form: FormData) {
  const day = text(form, "year_end_day");
  const month = text(form, "year_end_month");
  const registeredOn = text(form, "registered_on");
  const status = text(form, "status") || "active";
  if ((day && !month) || (!day && month)) return { error: "Please give both the day and the month of the year end, or neither." };
  if (day && month) {
    const d = new Date(Date.UTC(2024, Number(month) - 1, Number(day))); // 2024: allows 29 February
    if (d.getUTCMonth() !== Number(month) - 1) return { error: "That year end date doesn't exist." };
  }
  if (registeredOn && !isDate(registeredOn)) return { error: "Please enter the date as day, month and year." };
  const currency = text(form, "base_currency").toUpperCase() || null;
  if (currency && !/^[A-Z]{3}$/.test(currency)) return { error: "The currency should be three letters, e.g. GBP." };
  if (!["active", "dormant", "dissolved"].includes(status)) return { error: "Please choose the status from the list." };
  return {
    value: {
      name: text(form, "name"),
      registration_number: optional(form, "registration_number"),
      registered_on: registeredOn || null,
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

  const { data: entity, error } = await ctx.db
    .from("entities")
    .insert({ ...d.value, entity_type: entityType, jurisdiction, sub_type: subType, standard_id: standard.id })
    .select("id")
    .single();
  if (error || !entity) go(back, orgError(error?.message));
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
  if (!ctx.db || !ctx.canManage) go(`/families/${familyId}/organisation/${entityId}`, "Only a Manager can remove an entity.");
  const { error } = await ctx.db.from("entities").delete().eq("id", entityId);
  if (error) go(`/families/${familyId}/organisation/${entityId}`, orgError(error.message));
  go(`/families/${familyId}/organisation`, undefined, "entity_removed");
}

// ---------------------------------------------------------------------------
// Officers and appointments

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

  let personId: string | null = null;
  let organisationId: string | null = null;
  if (holder === "person") {
    personId = text(form, "person_id");
    if (!personId) go(back, "Please choose the person. Add them to the Tree first if they aren't there.");
  } else if (holder === "organisation") {
    organisationId = text(form, "organisation_id");
    if (!organisationId) {
      const name = text(form, "organisation_name");
      const kind = text(form, "organisation_kind") || "other";
      if (!name) go(back, "Please choose the organisation, or type the new organisation's name.");
      if (!(ORG_KINDS as readonly string[]).includes(kind)) go(back, "Please choose what kind of organisation it is.");
      const { data, error } = await db
        .from("outside_organisations")
        .insert({ name, kind, jurisdiction: optional(form, "organisation_jurisdiction") })
        .select("id")
        .single();
      if (error || !data) go(back, orgError(error?.message));
      organisationId = data.id;
    }
  } else {
    go(back, "Please say whether a person or an organisation holds the role.");
  }

  const { error } = await db.from("appointments").insert({
    entity_id: entityId,
    role,
    person_id: personId,
    organisation_id: organisationId,
    appointed_on: appointedOn || null,
    resident: form.get("resident") === "on",
    identity_verified: form.get("identity_verified") === "on",
    licensed: form.get("licensed") === "on",
    notes: optional(form, "notes"),
  });
  go(back, error ? orgError(error.message) : undefined, "appointment_added");
}

// Ending an appointment keeps it in the history.
export async function endAppointment(familyId: string, entityId: string, appointmentId: string) {
  const back = `/families/${familyId}/organisation/${entityId}?tab=officers`;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db || !ctx.canEdit) go(back, "You don't have permission to change this entity.");
  const { error } = await ctx.db
    .from("appointments")
    .update({ ceased_on: new Date().toISOString().slice(0, 10) })
    .eq("id", appointmentId)
    .eq("entity_id", entityId);
  go(back, error ? orgError(error.message) : undefined, "appointment_ended");
}

export async function removeAppointment(familyId: string, entityId: string, appointmentId: string) {
  const back = `/families/${familyId}/organisation/${entityId}?tab=officers`;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db || !ctx.canManage) go(back, "Only a Manager can remove an appointment from the history.");
  const { error } = await ctx.db.from("appointments").delete().eq("id", appointmentId).eq("entity_id", entityId);
  go(back, error ? orgError(error.message) : undefined, "appointment_removed");
}
