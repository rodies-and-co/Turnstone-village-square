import { londonDate } from "@/lib/organising";
import "server-only";
import { matchStandard, setupChecklist, type EntityType } from "@/lib/entity-checklist";
import type { FamilyContext } from "@/lib/family-context";
import { formatDate } from "@/lib/governance";
import type { EntityStandard } from "@/lib/standards";
import { loadCalendars, namer, today } from "../organisation/compliance-data";
import { loadOrganisationData } from "../organisation/organisation-data";
import { loadRecords } from "../meetings/meetings-data";

// The one to-do list and the calendar (decision 2.6): the to-dos people add,
// and what the records say needs doing, worked out each time from the
// records themselves. Every read runs as the signed-in person.

export const GROUPS = {
  filings: "Filings & compliance",
  meetings: "Meetings & minutes",
  resolutions: "Resolutions & signatures",
  payments: "Distributions & dividends",
  approvals: "Approvals waiting",
  setup: "Setup gaps",
  investments: "Investments",
  property: "Property",
  actions: "Actions & follow-ups",
  other: "Other",
} as const;
export type Group = keyof typeof GROUPS;
// The topics a person can give a to-do they add.
export const TOPICS: Partial<Record<Group, string>> = {
  actions: GROUPS.actions,
  filings: GROUPS.filings,
  meetings: GROUPS.meetings,
  resolutions: GROUPS.resolutions,
  investments: GROUPS.investments,
  property: GROUPS.property,
  other: GROUPS.other,
};
export const PRIORITIES = { high: "High", normal: "Normal", low: "Low" } as const;

export type Todo = {
  id: string;
  title: string;
  details: string | null;
  topic: Group;
  priority: keyof typeof PRIORITIES;
  due_on: string | null;
  assigned_to: string | null;
  entity_id: string | null;
  person_id: string | null;
  status: "open" | "done";
  done_by: string | null;
  done_at: string | null;
  created_by: string | null;
  updated_at: string;
};

export type Item = {
  key: string;
  group: Group;
  title: string;
  detail?: string | null;
  due: string | null;
  href: string;
  entityId: string | null;
  personIds: string[];
  todo?: Todo; // a to-do someone added; otherwise worked out from the records
};

export type CalendarKind = "meetings" | "filings" | "payments" | "todos" | "events" | "passports";
export const CALENDAR_KINDS: Record<CalendarKind, string> = {
  meetings: "Meetings",
  filings: "Filings",
  payments: "Payments",
  todos: "To-dos",
  events: "Family dates",
  passports: "Passport expiry",
};
export type CalendarEntry = {
  key: string;
  kind: CalendarKind;
  date: string;
  endDate?: string | null;
  time?: string | null;
  title: string;
  detail?: string | null;
  href: string;
  entityId: string | null;
  personIds: string[];
};

export type CalendarEvent = {
  id: string;
  title: string;
  kind: string;
  starts_on: string;
  ends_on: string | null;
  starts_at: string | null;
  location: string | null;
  details: string | null;
  entity_id: string | null;
  branch_id: string | null;
  people: string[];
};

// Who a to-do can be given to: the family's Managers and Administrators, and
// the Super User (from the hub).
export async function loadTeam(ctx: FamilyContext) {
  if (!ctx.canEdit) return new Map<string, string>();
  const { data } = await ctx.supabase.rpc("family_team", { p_family: ctx.family.id });
  return new Map(((data ?? []) as { user_id: string; name: string }[]).map((t) => [t.user_id, t.name]));
}

export async function loadOrganising(ctx: FamilyContext, names: Map<string, string>) {
  const db = ctx.db!;
  const f = ctx.family.id;
  const now = today();
  const [data, records, { data: todoRows }, { data: eventRows }, { data: distRows }, { data: divRows }, { data: removalRows }, { data: entRows }, { data: apptRows }, { data: stdRows }, { data: passportRows }] =
    await Promise.all([
      loadOrganisationData(ctx),
      loadRecords(ctx),
      ctx.canEdit ? db.from("todos").select("*").order("due_on", { ascending: true, nullsFirst: false }) : Promise.resolve({ data: [] }),
      db.from("calendar_events").select("*, calendar_event_people(person_id)").order("starts_on"),
      db.from("distributions").select("id, entity_id, amount, currency, status, declared_on, beneficiary_id, class_member_id"),
      db.from("dividends").select("id, entity_id, status, payment_date, declared_on, per_share, currency"),
      ctx.canEdit ? db.from("removal_requests").select("id, summary, status, requested_at, requested_by").eq("status", "pending") : Promise.resolve({ data: [] }),
      db.from("entities").select("id, name, entity_type, jurisdiction, sub_type, standard_id, registration_number, registered_address_id, base_currency, year_end_month, status"),
      db.from("appointments").select("entity_id, role, resident, identity_verified, licensed, organisation_id, holder_entity_id, ceased_on"),
      ctx.supabase.from("entity_standards").select("*"),
      db.from("passports").select("id, person_id, country, expires_on"),
    ]);
  const entityName = new Map(data.entities.map((e) => [e.id, e.name]));
  const calendars = await loadCalendars(ctx, data, namer(data, names));

  const items: Item[] = [];
  const entries: CalendarEntry[] = [];
  const soon = (d: string | null) => Boolean(d && d <= addDays(now, 60));

  // Filings and notices: overdue and due within 60 days (the rest show in the calendar).
  for (const c of calendars) {
    for (const i of c.items) {
      if (i.status === "filed" || i.status === "not_applicable") continue;
      const href = `/families/${f}/organisation/${c.entityId}?tab=compliance`;
      const title = `${i.obligation.name}${i.period ? ` – ${i.period}` : ""}`;
      if (i.status === "overdue" || i.status === "due_soon")
        items.push({ key: `filing:${c.entityId}:${i.obligation.key}:${i.periodKey ?? i.event?.key}`, group: "filings", title, detail: c.entityName, due: i.due, href, entityId: c.entityId, personIds: [] });
      entries.push({ key: `filing:${c.entityId}:${i.obligation.key}:${i.periodKey ?? i.event?.key}`, kind: "filings", date: i.due, title: `${title} (${c.entityName})`, href, entityId: c.entityId, personIds: [] });
    }
  }

  // Meetings and resolutions.
  const { meetings, resolutions } = records;
  const bodyName = (m: { entity_id: string | null; governance_body_id: string | null }) => (m.entity_id ? (entityName.get(m.entity_id) ?? "") : "Family governance");
  const { data: attRows } = await db.from("meeting_attendees").select("meeting_id, person_id");
  const { data: sigRows } = await db.from("resolution_signatories").select("resolution_id, person_id, signed_on");
  const attendees = (attRows ?? []) as { meeting_id: string; person_id: string | null }[];
  const signatories = (sigRows ?? []) as { resolution_id: string; person_id: string | null; signed_on: string | null }[];
  for (const m of meetings) {
    const href = `/families/${f}/meetings/${m.id}`;
    const people = attendees.filter((a) => a.meeting_id === m.id && a.person_id).map((a) => a.person_id!);
    if (m.status !== "cancelled")
      entries.push({ key: `meeting:${m.id}`, kind: "meetings", date: m.meeting_on, time: m.starts_at?.slice(0, 5), title: `${m.title} (${bodyName(m)})`, detail: m.location, href, entityId: m.entity_id, personIds: people });
    if (m.status === "held")
      items.push({ key: `meeting:${m.id}`, group: "meetings", title: `Confirm the record of the ${m.title.toLowerCase()} of ${formatDate(m.meeting_on)}`, detail: `${bodyName(m)}. A Manager who didn't record it confirms it.`, due: m.meeting_on, href, entityId: m.entity_id, personIds: people });
    if (m.status === "planned" && m.meeting_on < now)
      items.push({ key: `meeting-held:${m.id}`, group: "meetings", title: `Record the ${m.title.toLowerCase()} of ${formatDate(m.meeting_on)} as held (or cancel it)`, detail: bodyName(m), due: m.meeting_on, href, entityId: m.entity_id, personIds: people });
    if (m.status === "confirmed" && m.minutes_status !== "approved")
      items.push({ key: `minutes:${m.id}`, group: "meetings", title: `Approve the minutes of the ${m.title.toLowerCase()} of ${formatDate(m.meeting_on)}`, detail: `${bodyName(m)}. Minutes: ${m.minutes_status}.`, due: null, href, entityId: m.entity_id, personIds: people });
  }
  for (const r of resolutions) {
    const href = `/families/${f}/meetings/resolutions/${r.id}`;
    const mine = signatories.filter((s) => s.resolution_id === r.id);
    const unsigned = mine.filter((s) => !s.signed_on);
    if (r.status === "draft")
      items.push({ key: `resolution-draft:${r.id}`, group: "resolutions", title: `Circulate the draft resolution "${r.title}"`, detail: bodyName(r), due: null, href, entityId: r.entity_id, personIds: [] });
    if (r.status === "circulated")
      items.push({
        key: `resolution:${r.id}`,
        group: "resolutions",
        title: unsigned.length ? `Collect signatures: "${r.title}"` : `Confirm the resolution "${r.title}" has passed`,
        detail: `${bodyName(r)}. ${mine.length - unsigned.length} of ${mine.length} signed${ctx.canEdit ? "" : " (that you can see)"}.`,
        due: r.circulated_on,
        href,
        entityId: r.entity_id,
        personIds: unsigned.filter((s) => s.person_id).map((s) => s.person_id!),
      });
  }

  // Payments.
  for (const d of (distRows ?? []) as { id: string; entity_id: string; amount: number; currency: string; status: string; declared_on: string | null }[]) {
    if (d.status !== "declared") continue;
    const href = `/families/${f}/distributions?entity=${d.entity_id}`;
    items.push({ key: `distribution:${d.id}`, group: "payments", title: `Pay the distribution of ${d.currency} ${Number(d.amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })} and record the receipt`, detail: entityName.get(d.entity_id), due: d.declared_on, href, entityId: d.entity_id, personIds: [] });
  }
  for (const v of (divRows ?? []) as { id: string; entity_id: string; status: string; payment_date: string | null; declared_on: string | null }[]) {
    const href = `/families/${f}/distributions?entity=${v.entity_id}`;
    if (v.status === "declared")
      items.push({ key: `dividend:${v.id}`, group: "payments", title: "Pay the dividend and record each payment", detail: entityName.get(v.entity_id), due: v.payment_date ?? v.declared_on, href, entityId: v.entity_id, personIds: [] });
    if ((v.status === "declared" || v.status === "proposed") && v.payment_date)
      entries.push({ key: `dividend:${v.id}`, kind: "payments", date: v.payment_date, title: `Dividend payable (${entityName.get(v.entity_id) ?? ""})`, href, entityId: v.entity_id, personIds: [] });
  }

  // Approvals waiting.
  for (const t of data.transactions.filter((x) => x.status === "draft")) {
    items.push({
      key: `share:${t.id}`,
      group: "approvals",
      title: t.decision_id && t.basis === "decision" ? "Share transaction waiting for its decision" : "Approve a share transaction",
      detail: `${entityName.get(t.entity_id) ?? ""}. ${t.basis ? "" : "It needs to say what it was decided by."}`.trim(),
      due: t.transaction_date,
      href: `/families/${f}/organisation/${t.entity_id}?tab=ownership`,
      entityId: t.entity_id,
      personIds: [],
    });
  }
  for (const q of (removalRows ?? []) as { id: string; summary: string; requested_at: string; requested_by: string }[]) {
    items.push({
      key: `removal:${q.id}`,
      group: "approvals",
      title: `Removal waiting for approval: ${q.summary}`,
      detail: q.requested_by === ctx.user?.id ? "You asked for it, so another Manager approves it." : "A Manager who didn't ask approves it.",
      due: londonDate(q.requested_at),
      href: `/families/${f}`,
      entityId: null,
      personIds: [],
    });
  }

  // Setup gaps, from each entity's setup checklist.
  const standards = (stdRows ?? []) as EntityStandard[];
  type Ent = { id: string; name: string; entity_type: EntityType; jurisdiction: string; sub_type: string; standard_id: string | null; registration_number: string | null; registered_address_id: string | null; base_currency: string | null; year_end_month: number | null; status: string };
  type Ap = { entity_id: string; role: string; resident: boolean; identity_verified: boolean; licensed: boolean; organisation_id: string | null; holder_entity_id: string | null; ceased_on: string | null };
  const licensedOrgs = new Set(data.organisations.filter((o) => (o as unknown as { licensed?: boolean }).licensed).map((o) => o.id));
  for (const e of (entRows ?? []) as Ent[]) {
    if (e.status === "dissolved") continue;
    const current = ((apptRows ?? []) as Ap[])
      .filter((a) => a.entity_id === e.id && !a.ceased_on)
      .map((a) => ({ ...a, licensed: Boolean((a.organisation_id && licensedOrgs.has(a.organisation_id)) || a.holder_entity_id) }));
    const gaps = setupChecklist(e, current, matchStandard(standards, e)).filter((c) => !c.ok);
    for (const g of gaps)
      items.push({ key: `setup:${e.id}:${g.label}`, group: "setup", title: `${g.label}: ${e.name}`, detail: g.detail, due: null, href: `/families/${f}/organisation/${e.id}`, entityId: e.id, personIds: [] });
  }

  // To-dos people added.
  const todos = (todoRows ?? []) as Todo[];
  for (const t of todos) {
    items.push({
      key: `todo:${t.id}`,
      group: t.topic,
      title: t.title,
      detail: t.details,
      due: t.due_on,
      href: t.entity_id ? `/families/${f}/organisation/${t.entity_id}?tab=todo` : t.person_id ? `/families/${f}/tree/${t.person_id}?tab=todo` : `/families/${f}/organising`,
      entityId: t.entity_id,
      personIds: t.person_id ? [t.person_id] : [],
      todo: t,
    });
    if (t.due_on && t.status === "open")
      entries.push({ key: `todo:${t.id}`, kind: "todos", date: t.due_on, title: t.title, href: `/families/${f}/organising`, entityId: t.entity_id, personIds: t.person_id ? [t.person_id] : [] });
  }

  // Calendar entries people added.
  const events = ((eventRows ?? []) as (Omit<CalendarEvent, "people"> & { calendar_event_people: { person_id: string }[] })[]).map(
    ({ calendar_event_people, ...e }) => ({ ...e, people: calendar_event_people.map((p) => p.person_id) }),
  );
  for (const e of events)
    entries.push({
      key: `event:${e.id}`,
      kind: "events",
      date: e.starts_on,
      endDate: e.ends_on,
      time: e.starts_at?.slice(0, 5),
      title: e.title,
      detail: [e.location, e.entity_id ? entityName.get(e.entity_id) : null].filter(Boolean).join(" · ") || null,
      href: `/families/${f}/organising?view=calendar&month=${e.starts_on.slice(0, 7)}#event-${e.id}`,
      entityId: e.entity_id,
      personIds: e.people,
    });

  // Passports that expire.
  for (const p of (passportRows ?? []) as { id: string; person_id: string; country: string; expires_on: string | null }[]) {
    if (!p.expires_on) continue;
    entries.push({ key: `passport:${p.id}`, kind: "passports", date: p.expires_on, title: `${names.get(p.person_id) ?? "Someone"}'s ${p.country} passport expires`, href: `/families/${f}/tree/${p.person_id}?tab=identity`, entityId: null, personIds: [p.person_id] });
    if (ctx.canEdit && p.expires_on <= addDays(now, 180))
      items.push({
        key: `passport:${p.id}`,
        group: "actions",
        title: `${names.get(p.person_id) ?? "Someone"}'s ${p.country} passport ${p.expires_on < now ? "has expired" : "expires soon"}`,
        detail: "Ask for the new passport and record it.",
        due: p.expires_on,
        href: `/families/${f}/tree/${p.person_id}?tab=identity`,
        entityId: null,
        personIds: [p.person_id],
      });
  }

  // Only Managers and Administrators see the to-do list; Viewers see the calendar.
  return { items: ctx.canEdit ? items : [], entries, events, todos, now, soon, entityName };
}

export function addDays(d: string, n: number) {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
