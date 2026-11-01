// The Organisation: the setup checklist. Compares an entity's details and
// current officers with what its Entity Standard requires. Pure function,
// no database access, so it can be tested on its own.

export const ENTITY_TYPES = {
  company: "Company",
  trust: "Trust",
  foundation: "Foundation",
  llc: "LLC",
  partnership: "Partnership",
} as const;
export type EntityType = keyof typeof ENTITY_TYPES;

export const APPOINTMENT_ROLES = {
  director: "Director",
  alternate_director: "Alternate director",
  secretary: "Company secretary",
  nominated_officer: "Nominated officer",
  registered_agent: "Registered agent",
  management_company: "Management company",
  public_officer: "Public officer",
  auditor: "Auditor",
  accounting_officer: "Accounting officer",
  trustee: "Trustee",
  protector: "Protector",
  enforcer: "Enforcer",
  council_member: "Council member",
  designated_member: "Designated member",
  member: "Member",
  manager: "Manager",
  general_partner: "General partner",
  limited_partner: "Limited partner",
} as const;
export type AppointmentRole = keyof typeof APPOINTMENT_ROLES;

// Which roles make sense for each kind of entity (shown first in the form).
export const ROLES_FOR: Record<EntityType, AppointmentRole[]> = {
  company: ["director", "alternate_director", "secretary", "nominated_officer", "registered_agent", "management_company", "public_officer", "auditor", "accounting_officer"],
  trust: ["trustee", "protector", "enforcer", "registered_agent", "auditor"],
  foundation: ["council_member", "secretary", "protector", "enforcer", "registered_agent", "nominated_officer", "management_company", "auditor"],
  llc: ["member", "manager", "registered_agent", "nominated_officer", "auditor"],
  partnership: ["general_partner", "limited_partner", "designated_member", "member", "registered_agent", "auditor"],
};

export type Standard = {
  min_directors: number;
  min_resident_directors: number;
  secretary_required: boolean;
  registered_office_required: boolean;
  registered_agent_required: boolean;
  nominated_officer_required: boolean;
  management_company_required: boolean;
  public_officer_required: boolean;
  auditor_required: boolean;
  accounting_officer_required: boolean;
  min_trustees: number;
  licensed_trustee_required: boolean;
  min_council_members: number;
  min_resident_council_members: number;
  enforcer_required: boolean;
  min_designated_members: number;
  identity_verification_required: boolean;
  share_capital: "required" | "optional" | "none";
  authorised_capital: "required" | "optional" | "none";
};

export type ChecklistEntity = {
  entity_type: EntityType;
  registration_number: string | null;
  registered_address_id: string | null;
  base_currency: string | null;
  year_end_month: number | null;
};

export type CurrentAppointment = { role: string; resident: boolean; identity_verified: boolean; licensed: boolean };

export type CheckItem = { label: string; ok: boolean; detail: string };

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function atLeast(label: string, have: number, need: number, one: string, many: string): CheckItem {
  return { label, ok: have >= need, detail: `${count(have, one, many)} recorded; at least ${need} required.` };
}

function present(label: string, have: number): CheckItem {
  return { label, ok: have > 0, detail: have > 0 ? "Recorded." : "Required, not recorded yet." };
}

// The checks. With no standard, only the general minimums apply.
export function setupChecklist(entity: ChecklistEntity, appointments: CurrentAppointment[], standard: Standard | null): CheckItem[] {
  const of = (role: string) => appointments.filter((a) => a.role === role);
  const items: CheckItem[] = [];

  items.push({
    label: "Registration number",
    ok: Boolean(entity.registration_number),
    detail: entity.registration_number ? "Recorded." : "Not recorded yet.",
  });

  if (!standard || standard.registered_office_required) {
    items.push({
      label: "Registered office",
      ok: Boolean(entity.registered_address_id),
      detail: entity.registered_address_id ? "Recorded." : "Required, not recorded yet.",
    });
  }

  if (entity.entity_type !== "trust" && entity.entity_type !== "partnership") {
    items.push({ label: "Financial year end", ok: Boolean(entity.year_end_month), detail: entity.year_end_month ? "Recorded." : "Not recorded yet." });
  }

  if (!standard) return items;

  const directors = of("director");
  if (standard.min_directors > 0) items.push(atLeast("Directors", directors.length, standard.min_directors, "director", "directors"));
  if (standard.min_resident_directors > 0) {
    items.push(atLeast("Resident directors", directors.filter((d) => d.resident).length, standard.min_resident_directors, "resident director", "resident directors"));
  }
  if (standard.secretary_required) items.push(present("Secretary", of("secretary").length));
  if (standard.registered_agent_required) items.push(present("Registered agent", of("registered_agent").length));
  if (standard.nominated_officer_required) items.push(present("Nominated officer", of("nominated_officer").length));
  if (standard.management_company_required) items.push(present("Management company", of("management_company").length));
  if (standard.public_officer_required) items.push(present("Public officer", of("public_officer").length));
  if (standard.auditor_required) items.push(present("Auditor", of("auditor").length));
  if (standard.accounting_officer_required) items.push(present("Accounting officer", of("accounting_officer").length));

  const trustees = of("trustee");
  if (standard.min_trustees > 0) items.push(atLeast("Trustees", trustees.length, standard.min_trustees, "trustee", "trustees"));
  if (standard.licensed_trustee_required) {
    const n = trustees.filter((t) => t.licensed).length;
    items.push({ label: "Licensed trustee", ok: n > 0, detail: n > 0 ? "Recorded." : "At least one trustee must be a licensed trust company or private trust company." });
  }

  const council = of("council_member");
  if (standard.min_council_members > 0) items.push(atLeast("Council members", council.length, standard.min_council_members, "council member", "council members"));
  if (standard.min_resident_council_members > 0) {
    items.push(
      atLeast("Resident council members", council.filter((c) => c.resident).length, standard.min_resident_council_members, "resident council member", "resident council members"),
    );
  }
  if (standard.enforcer_required) items.push(present("Enforcer", of("enforcer").length));
  if (standard.min_designated_members > 0) {
    items.push(atLeast("Designated members", of("designated_member").length, standard.min_designated_members, "designated member", "designated members"));
  }

  if (standard.identity_verification_required) {
    // Directors, and every member of an LLP or partnership.
    const officers = [...directors, ...of("designated_member"), ...of("member")];
    const unverified = officers.filter((o) => !o.identity_verified).length;
    items.push({
      label: "Identity verification",
      ok: officers.length > 0 && unverified === 0,
      detail: officers.length === 0 ? "Required for every director, once they are recorded." : unverified ? `${count(unverified, "officer", "officers")} not verified yet.` : "Every officer is verified.",
    });
  }

  if (standard.share_capital === "required") {
    items.push({
      label: "Share capital currency",
      ok: Boolean(entity.base_currency),
      detail: entity.base_currency ? `${entity.base_currency}.` : "Required: the currency of the shares, which becomes the company's base currency.",
    });
  }

  return items;
}

// Find the standard for an entity: same jurisdiction, type and sub-type,
// ignoring capital letters; the newest approved version first, then the
// newest draft. Retired standards are never used.
export function matchStandard<T extends { jurisdiction: string; entity_type: string; sub_type: string; status: string; version: number }>(
  standards: T[],
  entity: { jurisdiction: string; entity_type: string; sub_type: string },
): T | null {
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const matches = standards
    .filter((s) => s.status !== "retired" && same(s.jurisdiction, entity.jurisdiction) && s.entity_type === entity.entity_type && same(s.sub_type, entity.sub_type))
    .sort((a, b) => Number(b.status === "approved") - Number(a.status === "approved") || b.version - a.version);
  return matches[0] ?? null;
}

// The closest standard to copy from when a new draft is needed: the same
// jurisdiction and type with another sub-type, otherwise none (general
// minimums).
export function closestStandard<T extends { jurisdiction: string; entity_type: string; status: string }>(
  standards: T[],
  entity: { jurisdiction: string; entity_type: string },
): T | null {
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  return (
    standards
      .filter((s) => s.status !== "retired" && same(s.jurisdiction, entity.jurisdiction) && s.entity_type === entity.entity_type)
      .sort((a, b) => Number(b.status === "approved") - Number(a.status === "approved"))[0] ?? null
  );
}
