import "server-only";
import { addMonths, entityCalendar, type CalendarItem, type CalendarProblem, type ComplianceEvent, type Filing, type Obligation } from "@/lib/compliance";
import { APPOINTMENT_ROLES, matchStandard } from "@/lib/entity-checklist";
import type { FamilyContext } from "@/lib/family-context";
import type { Holder } from "@/lib/ownership";
import type { OrganisationData } from "./organisation-data";

// The compliance calendar for the family's entities: obligations come from
// each entity's current Entity Standard (in the hub), events from what is
// recorded (appointments, share transactions, beneficiaries), and what has
// been done from the family's own filing records.

export type EntityCalendar = {
  entityId: string;
  entityName: string;
  standardName: string | null;
  standardDraft: boolean;
  items: CalendarItem[];
  problems: CalendarProblem[];
  failed?: boolean; // the filing records couldn't be read
};

type StandardRow = { id: string; name: string; jurisdiction: string; entity_type: string; sub_type: string; status: string; version: number };

export function today() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" }); // YYYY-MM-DD
}

// The events recorded for one entity that may need a notice.
export function entityEvents(entityId: string, data: OrganisationData, nameOf: (h: Holder | null) => string): ComplianceEvent[] {
  const events: ComplianceEvent[] = [];
  for (const a of data.appointments.filter((x) => x.entity_id === entityId)) {
    const role = APPOINTMENT_ROLES[a.role as keyof typeof APPOINTMENT_ROLES]?.toLowerCase() ?? a.role;
    if (a.appointed_on) events.push({ type: "officer_change", role: a.role, date: a.appointed_on, key: `appt:${a.id}:start`, label: `${nameOf(a.holder)} appointed ${role}` });
    if (a.ceased_on) events.push({ type: "officer_change", role: a.role, date: a.ceased_on, key: `appt:${a.id}:end`, label: `${nameOf(a.holder)} stopped being ${role}` });
  }
  for (const t of data.transactions.filter((x) => x.entity_id === entityId && x.status === "approved" && x.kind !== "authorise")) {
    const n = Number(t.shares).toLocaleString("en-GB");
    if (t.kind === "issue") events.push({ type: "share_issue", date: t.transaction_date, key: `tx:${t.id}`, label: `${n} shares issued to ${nameOf(t.to)}` });
    else events.push({ type: "member_change", date: t.transaction_date, key: `tx:${t.id}`, label: `${n} shares transferred from ${nameOf(t.from)} to ${nameOf(t.to)}` });
  }
  // For trusts and foundations: changes of settlors, beneficiaries and class members.
  for (const s of data.settlements.filter((x) => x.entity_id === entityId && x.settled_on)) {
    events.push({ type: "bo_change", date: String(s.settled_on), key: `settlement:${s.id}`, label: "Settlement recorded" });
  }
  for (const b of data.beneficiaries.filter((x) => x.entity_id === entityId)) {
    if (b.added_on) events.push({ type: "bo_change", date: String(b.added_on), key: `beneficiary:${b.id}:start`, label: "Beneficiary added" });
    if (b.ceased_on) events.push({ type: "bo_change", date: String(b.ceased_on), key: `beneficiary:${b.id}:end`, label: "Beneficiary removed" });
  }
  for (const m of data.classMembers.filter((x) => x.entity_id === entityId)) {
    const who = nameOf({ kind: "person", id: m.person_id });
    if (m.added_on) events.push({ type: "bo_change", date: m.added_on, key: `member:${m.id}:start`, label: `${who} added to a class of beneficiaries` });
    if (m.ceased_on) events.push({ type: "bo_change", date: m.ceased_on, key: `member:${m.id}:end`, label: `${who} taken out of a class of beneficiaries` });
  }
  return events;
}

export async function loadCalendars(ctx: FamilyContext, data: OrganisationData, nameOf: (h: Holder | null) => string, only?: string): Promise<EntityCalendar[]> {
  const entities = data.entities.filter((e) => !only || e.id === only);
  const [{ data: standardRows }, { data: filingRows, error: filingError }] = await Promise.all([
    ctx.supabase.from("entity_standards").select("id, name, jurisdiction, entity_type, sub_type, status, version"),
    ctx.db!.from("compliance_filings").select("id, entity_id, obligation_key, due_date, period_key, event_key, status, done_on, reference, notes"),
  ]);
  const standards = (standardRows ?? []) as StandardRow[];
  const matched = new Map(entities.map((e) => [e.id, matchStandard(standards, e)]));
  const ids = [...new Set([...matched.values()].filter(Boolean).map((s) => s!.id))];
  const { data: obligationRows } = ids.length
    ? await ctx.supabase.from("standard_obligations").select("*").in("standard_id", ids).order("sort")
    : { data: [] };
  const obligations = (obligationRows ?? []) as (Obligation & { standard_id: string })[];
  const filings = (filingRows ?? []) as (Filing & { entity_id: string })[];
  const now = today();

  return entities.map((e) => {
    const s = matched.get(e.id) ?? null;
    // Tracked from the date chosen on the entity, or from 12 months before it
    // was added here (earlier years are the family's history, not to-dos).
    const trackFrom = e.compliance_from ?? addMonths(e.created_at.slice(0, 10), -12);
    const { items, problems } = entityCalendar(
      { ...e, track_from: trackFrom },
      s ? obligations.filter((o) => o.standard_id === s.id) : [],
      entityEvents(e.id, data, nameOf),
      filings.filter((f) => f.entity_id === e.id),
      now,
    );
    return { entityId: e.id, entityName: e.name, standardName: s?.name ?? null, standardDraft: s?.status === "draft", items, problems, failed: Boolean(filingError) };
  });
}

// A name for anyone who can hold shares or roles.
export function namer(data: OrganisationData, people: Map<string, string>) {
  const entityName = new Map(data.entities.map((e) => [e.id, e.name]));
  const orgName = new Map(data.organisations.map((o) => [o.id, o.name]));
  return (h: Holder | null) =>
    !h
      ? "—"
      : h.kind === "person"
        ? (people.get(h.id) ?? "someone you can't see")
        : h.kind === "entity"
          ? (entityName.get(h.id) ?? "an entity you can't see")
          : (orgName.get(h.id) ?? "a service provider");
}

