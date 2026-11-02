import "server-only";
import type { FamilyContext } from "@/lib/family-context";
import {
  MANAGER_ROLES,
  PARTY_ROLES,
  holderFrom,
  ownershipShares,
  registerOfMembers,
  type EntityOwnership,
  type Holder,
  type ShareClass,
  type ShareTransaction,
} from "@/lib/ownership";

// Everything the family records about its entities and who owns and runs
// them, loaded once for the pages that need it (Ownership & control,
// Registers, the structure chart and the compliance calendar). Each query
// runs as the signed-in person, so Viewers only get what they may see.

type Row = Record<string, unknown>;
export type EntityRow = {
  id: string;
  name: string;
  entity_type: string;
  jurisdiction: string;
  sub_type: string;
  registration_number: string | null;
  registered_on: string | null;
  registered_address_id: string | null;
  year_end_month: number | null;
  year_end_day: number | null;
  status: string;
  dissolved_on: string | null;
  compliance_from: string | null;
  created_at: string;
  branch_id: string | null;
};
export type Organisation = {
  id: string;
  name: string;
  jurisdiction: string | null;
  registration_number: string | null;
  incorporated_on: string | null;
  address_id: string | null;
};
export type Transaction = ShareTransaction & {
  entity_id: string;
  prepared_by: string | null;
  edited_by: string[];
  updated_at: string;
  resolution: string | null;
  consideration: string | null;
  basis: string | null;
  decision_id: string | null;
  basis_note: string | null;
};
export type Appointment = {
  id: string;
  entity_id: string;
  role: string;
  person_id: string | null;
  organisation_id: string | null;
  holder_entity_id: string | null;
  appointed_on: string | null;
  ceased_on: string | null;
  holder: Holder | null;
};

export const SHARE_TYPES = ["company", "llc"];
export const TRUST_TYPES = ["trust", "foundation"];

export async function loadOrganisationData(ctx: FamilyContext) {
  const db = ctx.db!;
  const [ents, orgs, classes, txs, setts, bens, bclasses, bmembers, appts] = await Promise.all([
    db
      .from("entities")
      .select(
        "id, name, entity_type, jurisdiction, sub_type, registration_number, registered_on, registered_address_id, year_end_month, year_end_day, status, dissolved_on, compliance_from, created_at, branch_id",
      )
      .order("name"),
    db.from("outside_organisations").select("id, name, jurisdiction, registration_number, incorporated_on, address_id").order("name"),
    db.from("share_classes").select("id, entity_id, name, currency, par_value, limited, voting, created_at").order("created_at"),
    db.from("share_transactions").select("*").order("transaction_date"),
    db.from("settlements").select("*").order("settled_on"),
    db.from("beneficiaries").select("*").order("created_at"),
    db.from("beneficiary_classes").select("id, entity_id, name, description").order("name"),
    db.from("beneficiary_class_members").select("id, entity_id, class_id, person_id, added_on, ceased_on"),
    db.from("appointments").select("id, entity_id, role, person_id, organisation_id, holder_entity_id, appointed_on, ceased_on"),
  ]);
  const entities = (ents.data ?? []) as EntityRow[];
  const organisations = (orgs.data ?? []) as Organisation[];
  const classesAll = (classes.data ?? []) as (ShareClass & { entity_id: string })[];
  const transactions: Transaction[] = ((txs.data ?? []) as Row[]).map((t) => ({
    ...(t as unknown as ShareTransaction),
    entity_id: String(t.entity_id),
    prepared_by: t.prepared_by as string | null,
    edited_by: (t.edited_by as string[] | null) ?? [],
    updated_at: String(t.updated_at),
    resolution: t.resolution as string | null,
    consideration: t.consideration as string | null,
    basis: (t.basis as string | null) ?? null,
    decision_id: (t.decision_id as string | null) ?? null,
    basis_note: (t.basis_note as string | null) ?? null,
    to: holderFrom(t, "to_"),
    from: holderFrom(t, "from_"),
  }));
  const settlements = (setts.data ?? []) as Row[];
  const beneficiaries = (bens.data ?? []) as Row[];
  const beneficiaryClasses = (bclasses.data ?? []) as { id: string; entity_id: string; name: string; description: string | null }[];
  const classMembers = (bmembers.data ?? []) as { id: string; entity_id: string; class_id: string; person_id: string; added_on: string | null; ceased_on: string | null }[];
  const appointments: Appointment[] = ((appts.data ?? []) as Row[]).map((a) => ({ ...(a as unknown as Appointment), holder: holderFrom(a) }));

  const registersFor = (id: string) =>
    registerOfMembers(
      classesAll.filter((c) => c.entity_id === id),
      transactions.filter((t) => t.entity_id === id),
    );

  // What each entity contributes to the beneficial-owner calculation.
  const graph: EntityOwnership[] = entities.map((e) => {
    const parties: EntityOwnership["parties"] = [];
    for (const s of settlements.filter((x) => x.entity_id === e.id)) {
      const h = holderFrom(s);
      if (h) parties.push({ holder: h, role: e.entity_type === "foundation" ? "Founder" : "Settlor" });
    }
    for (const b of beneficiaries.filter((x) => x.entity_id === e.id && !x.ceased_on)) {
      const h = holderFrom(b);
      if (h) parties.push({ holder: h, role: "Beneficiary" });
    }
    for (const m of classMembers.filter((x) => x.entity_id === e.id && !x.ceased_on)) {
      const cls = beneficiaryClasses.find((c) => c.id === m.class_id);
      parties.push({ holder: { kind: "person", id: m.person_id }, role: `Beneficiary (${cls?.name ?? "a class"})` });
    }
    const current = appointments.filter((a) => a.entity_id === e.id && !a.ceased_on);
    for (const a of current) {
      if (a.holder && PARTY_ROLES[a.role]) parties.push({ holder: a.holder, role: PARTY_ROLES[a.role] });
    }
    return {
      id: e.id,
      name: e.name,
      entity_type: e.entity_type,
      shareholders: SHARE_TYPES.includes(e.entity_type)
        ? ownershipShares(registersFor(e.id)).map((o) => ({ holder: o.holder, percent: Math.max(o.percent, o.votingPercent) }))
        : [],
      parties,
      managers: current.flatMap((a) => (a.holder && MANAGER_ROLES[a.role] ? [{ holder: a.holder, role: MANAGER_ROLES[a.role] }] : [])),
    };
  });

  return {
    entities,
    organisations,
    classes: classesAll,
    transactions,
    settlements,
    beneficiaries,
    beneficiaryClasses,
    classMembers,
    appointments,
    registersFor,
    graph,
  };
}

export type OrganisationData = Awaited<ReturnType<typeof loadOrganisationData>>;
