import "server-only";
import { APPOINTMENT_ROLES, type AppointmentRole } from "@/lib/entity-checklist";
import type { FamilyContext } from "@/lib/family-context";
import { displayNames, type PersonSummary } from "@/lib/people";
import type { TimelineItem } from "@/lib/timeline";
import { loadRecords } from "../meetings/meetings-data";
import { namer } from "../organisation/compliance-data";
import { loadOrganisationData } from "../organisation/organisation-data";

// The family / branch timeline, worked out from the records already kept,
// plus the events added by hand. Every read runs as the signed-in person, so
// each sees only what they may see (Viewers see years of birth, not dates).

const STATEMENT: Record<string, string> = { purpose: "Purpose", vision: "Vision", mission: "Mission", values: "Values", arrangement: "Arrangement", guidance: "Guidance" };
const PARTNER: Record<string, [string, string]> = {
  marriage: ["Married", "marriage"],
  civil_partnership: ["Civil partnership", "civil partnership"],
  partner: ["Became partners", "partnership"],
};
const ENDED: Record<string, string> = { divorce: "Divorced", separation: "Separated", death: "Ended by death" };

export type AddedEvent = {
  id: string;
  title: string;
  happened_on: string;
  precision: "day" | "month" | "year";
  category: string;
  details: string | null;
  entity_id: string | null;
  branch_id: string | null;
  people: string[];
};

export async function loadTimeline(ctx: FamilyContext) {
  const db = ctx.db!;
  const f = `/families/${ctx.family.id}`;
  const [{ data: peopleRows }, { data: detailRows }, { data: partnerRows }, { data: branchRows }, data, records, { data: stmtRows }, { data: distRows }, { data: divRows }, { data: projRows }, { data: eventRows }] =
    await Promise.all([
      db.from("people").select("id, full_names, surname, known_as, birth_year, branch_id, deceased"),
      db.from("person_details").select("person_id, date_of_birth, date_of_death"),
      db.from("partnerships").select("id, person_a, person_b, kind, start_date, end_date, end_reason"),
      db.from("branches").select("id, name"),
      loadOrganisationData(ctx),
      loadRecords(ctx),
      db.from("family_statements").select("id, kind, title, status, adopted_on, branch_id"),
      db.from("distributions").select("id, entity_id, amount, currency, status, paid_on"),
      db.from("dividends").select("id, entity_id, status, payment_date, per_share, currency, kind"),
      db.from("projects").select("id, title, stage, finished_on, entity_id, branch_id"),
      db.from("timeline_events").select("*, timeline_event_people(person_id)").order("happened_on"),
    ]);
  const { data: storyRows } = await db.from("stories").select("id, title, happened_on, precision, status, story_people(person_id)").eq("status", "published").not("happened_on", "is", null);
  const people = (peopleRows ?? []) as (PersonSummary & { branch_id: string | null; deceased: boolean })[];
  const names = displayNames(people);
  const branchOfPerson = new Map(people.map((p) => [p.id, p.branch_id]));
  const entityBranch = new Map(data.entities.map((e) => [e.id, e.branch_id]));
  const entityName = new Map(data.entities.map((e) => [e.id, e.name]));
  const holderName = namer(data, names);
  const items: TimelineItem[] = [];
  const name = (id: string) => names.get(id) ?? "Someone";

  // Family life: births, partnerships, deaths.
  const deceased = new Set<string>();
  const details = new Map(((detailRows ?? []) as { person_id: string; date_of_birth: string | null; date_of_death: string | null }[]).map((d) => [d.person_id, d]));
  for (const p of people) {
    const d = details.get(p.id);
    if (d?.date_of_birth) items.push({ key: `born:${p.id}`, kind: "family", date: d.date_of_birth, precision: "day", title: `${name(p.id)} was born`, href: `${f}/tree/${p.id}`, personIds: [p.id] });
    else if (p.birth_year) items.push({ key: `born:${p.id}`, kind: "family", date: `${p.birth_year}-01-01`, precision: "year", title: `${name(p.id)} was born`, href: `${f}/tree/${p.id}`, personIds: [p.id] });
    if (d?.date_of_death) items.push({ key: `died:${p.id}`, kind: "family", date: d.date_of_death, precision: "day", title: `${name(p.id)} died`, href: `${f}/tree/${p.id}`, personIds: [p.id] });
    // The date of death isn't shown to Viewers: the year comes from a marriage ended by death, if recorded.
    else if (p.deceased) deceased.add(p.id);
  }
  for (const r of (partnerRows ?? []) as { id: string; person_a: string; person_b: string; kind: string; start_date: string | null; end_date: string | null; end_reason: string | null }[]) {
    const couple = `${name(r.person_a)} and ${name(r.person_b)}`;
    const [started, word] = PARTNER[r.kind] ?? ["Partners", "partnership"];
    if (r.start_date) items.push({ key: `partner:${r.id}`, kind: "family", date: r.start_date, precision: "day", title: `${started}: ${couple}`, href: `${f}/tree/${r.person_a}?tab=relationships`, personIds: [r.person_a, r.person_b] });
    if (r.end_date && r.end_reason === "death")
      for (const who of [r.person_a, r.person_b])
        if (deceased.has(who)) {
          deceased.delete(who);
          items.push({ key: `died:${who}`, kind: "family", date: `${r.end_date.slice(0, 4)}-01-01`, precision: "year", title: `${name(who)} died`, href: `${f}/tree/${who}`, personIds: [who] });
        }
    if (r.end_date && r.end_reason !== "death")
      items.push({ key: `partner-end:${r.id}`, kind: "family", date: r.end_date, precision: "day", title: `${ENDED[r.end_reason ?? ""] ?? "The " + word + " ended"}: ${couple}`, href: `${f}/tree/${r.person_a}?tab=relationships`, personIds: [r.person_a, r.person_b] });
  }

  // Entities and ownership.
  for (const e of data.entities) {
    const href = `${f}/organisation/${e.id}`;
    if (e.registered_on) items.push({ key: `formed:${e.id}`, kind: "entities", date: e.registered_on, precision: "day", title: `${e.name} was formed`, detail: `${e.sub_type}, ${e.jurisdiction}`, href, personIds: [], entityId: e.id, branchId: e.branch_id });
    if (e.dissolved_on) items.push({ key: `dissolved:${e.id}`, kind: "entities", date: e.dissolved_on, precision: "day", title: `${e.name} was dissolved`, href, personIds: [], entityId: e.id, branchId: e.branch_id });
  }
  for (const s of data.settlements as unknown as { id: string; entity_id: string; kind: string; settled_on: string | null; person_id: string | null; organisation_id: string | null; holder_entity_id: string | null; amount: number | null; currency: string | null; description: string | null }[]) {
    const settlor = s.person_id ? name(s.person_id) : s.organisation_id ? holderName({ kind: "organisation", id: s.organisation_id }) : s.holder_entity_id ? holderName({ kind: "entity", id: s.holder_entity_id }) : null;
    if (!s.settled_on) continue;
    items.push({
      key: `settled:${s.id}`,
      kind: "entities",
      date: s.settled_on,
      precision: "day",
      title: `${s.kind === "initial" ? "Settled" : "Added to"}: ${entityName.get(s.entity_id) ?? "an entity"}`,
      detail: [settlor ? `By ${settlor}` : null, s.description, s.amount != null ? `${s.currency ?? ""} ${Number(s.amount).toLocaleString("en-GB")}`.trim() : null].filter(Boolean).join(" · ") || null,
      href: `${f}/organisation/${s.entity_id}?tab=ownership`,
      personIds: s.person_id ? [s.person_id] : [],
      entityId: s.entity_id,
      branchId: entityBranch.get(s.entity_id) ?? null,
    });
  }
  for (const t of data.transactions) {
    if (t.status !== "approved" || t.kind === "authorise") continue;
    const ent = entityName.get(t.entity_id) ?? "a company";
    const who = (h: typeof t.to) => (h ? holderName(h) : "—");
    items.push({
      key: `shares:${t.id}`,
      kind: "entities",
      date: t.transaction_date,
      precision: "day",
      title: t.kind === "issue" ? `${ent}: ${Number(t.shares).toLocaleString("en-GB")} shares issued to ${who(t.to)}` : `${ent}: ${Number(t.shares).toLocaleString("en-GB")} shares transferred from ${who(t.from)} to ${who(t.to)}`,
      href: `${f}/organisation/${t.entity_id}?tab=ownership`,
      personIds: [t.to, t.from].flatMap((h) => (h?.kind === "person" ? [h.id] : [])),
      entityId: t.entity_id,
      branchId: entityBranch.get(t.entity_id) ?? null,
    });
  }
  for (const a of data.appointments) {
    const role = APPOINTMENT_ROLES[a.role as AppointmentRole] ?? a.role;
    const who = a.holder ? holderName(a.holder) : "Someone";
    const ent = entityName.get(a.entity_id) ?? "an entity";
    const base = { kind: "entities" as const, precision: "day" as const, href: `${f}/organisation/${a.entity_id}?tab=officers`, personIds: a.person_id ? [a.person_id] : [], entityId: a.entity_id, branchId: entityBranch.get(a.entity_id) ?? null };
    if (a.appointed_on) items.push({ ...base, key: `appointed:${a.id}`, date: a.appointed_on, title: `${who} became ${role.toLowerCase()} of ${ent}` });
    if (a.ceased_on) items.push({ ...base, key: `ceased:${a.id}`, date: a.ceased_on, title: `${who} stopped being ${role.toLowerCase()} of ${ent}` });
  }

  // Governance.
  for (const m of records.meetings.filter((x) => x.status === "confirmed"))
    items.push({
      key: `meeting:${m.id}`,
      kind: "governance",
      date: m.meeting_on,
      precision: "day",
      title: `${m.title}${m.entity_id ? ` (${entityName.get(m.entity_id) ?? ""})` : ""}`,
      detail: m.number ? `Minute ${m.number}` : null,
      href: `${f}/meetings/${m.id}`,
      personIds: [],
      entityId: m.entity_id,
      branchId: m.entity_id ? (entityBranch.get(m.entity_id) ?? null) : null,
    });
  for (const r of records.resolutions.filter((x) => x.status === "passed" && x.passed_on))
    items.push({
      key: `resolution:${r.id}`,
      kind: "governance",
      date: r.passed_on!,
      precision: "day",
      title: `Resolution passed: ${r.title}${r.entity_id ? ` (${entityName.get(r.entity_id) ?? ""})` : ""}`,
      href: `${f}/meetings/resolutions/${r.id}`,
      personIds: [],
      entityId: r.entity_id,
      branchId: r.entity_id ? (entityBranch.get(r.entity_id) ?? null) : null,
    });
  for (const s of (stmtRows ?? []) as { id: string; kind: string; title: string; status: string; adopted_on: string | null; branch_id: string | null }[])
    if (s.status === "adopted" && s.adopted_on)
      items.push({ key: `statement:${s.id}`, kind: "governance", date: s.adopted_on, precision: "day", title: `${STATEMENT[s.kind] ?? "Statement"} adopted: ${s.title}`, href: `${f}/branches/values`, personIds: [], branchId: s.branch_id });
  for (const d of (distRows ?? []) as { id: string; entity_id: string; amount: number; currency: string; status: string; paid_on: string | null }[])
    if (d.status === "paid" && d.paid_on)
      items.push({ key: `dist:${d.id}`, kind: "governance", date: d.paid_on, precision: "day", title: `Distribution paid by ${entityName.get(d.entity_id) ?? "a trust or foundation"}`, detail: `${d.currency} ${Number(d.amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`, href: `${f}/distributions`, personIds: [], entityId: d.entity_id, branchId: entityBranch.get(d.entity_id) ?? null });
  for (const v of (divRows ?? []) as { id: string; entity_id: string; status: string; payment_date: string | null; kind: string }[])
    if (v.status === "paid" && v.payment_date)
      items.push({ key: `div:${v.id}`, kind: "governance", date: v.payment_date, precision: "day", title: `${v.kind === "interim" ? "Interim" : v.kind === "special" ? "Special" : "Final"} dividend paid by ${entityName.get(v.entity_id) ?? "a company"}`, href: `${f}/distributions`, personIds: [], entityId: v.entity_id, branchId: entityBranch.get(v.entity_id) ?? null });
  for (const p of (projRows ?? []) as { id: string; title: string; stage: string; finished_on: string | null; entity_id: string | null; branch_id: string | null }[])
    if (p.stage === "completed" && p.finished_on)
      items.push({ key: `project:${p.id}`, kind: "governance", date: p.finished_on, precision: "day", title: `Project completed: ${p.title}`, href: `${f}/projects/${p.id}`, personIds: [], entityId: p.entity_id, branchId: p.branch_id ?? (p.entity_id ? (entityBranch.get(p.entity_id) ?? null) : null) });

  // Stories with a date.
  for (const s of (storyRows ?? []) as { id: string; title: string; happened_on: string; precision: "day" | "month" | "year"; story_people: { person_id: string }[] }[])
    items.push({ key: `story:${s.id}`, kind: "stories", date: s.happened_on, precision: s.precision, title: s.title, href: `${f}/story/${s.id}`, personIds: s.story_people.map((x) => x.person_id) });

  // Events added by hand.
  const added = ((eventRows ?? []) as (Omit<AddedEvent, "people"> & { timeline_event_people: { person_id: string }[] })[]).map(({ timeline_event_people, ...e }) => ({ ...e, people: timeline_event_people.map((x) => x.person_id) }));
  for (const e of added)
    items.push({ key: `event:${e.id}`, kind: "added", date: e.happened_on, precision: e.precision, title: e.title, detail: e.details, personIds: e.people, entityId: e.entity_id, branchId: e.branch_id ?? (e.entity_id ? (entityBranch.get(e.entity_id) ?? null) : null) });

  // Which branch an item belongs to: its own, or that of anyone in it.
  // Family-wide turning points (no branch, no people) show in every branch's view.
  const inBranch = (i: TimelineItem, branch: string) =>
    i.branchId === branch || i.personIds.some((p) => branchOfPerson.get(p) === branch) || (!i.branchId && i.personIds.length === 0 && (!i.entityId || entityBranch.get(i.entityId) == null));
  return {
    items,
    added,
    names,
    people: [...names.entries()].sort((a, b) => a[1].localeCompare(b[1])),
    branches: ((branchRows ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name] as [string, string]),
    entities: data.entities.map((e) => [e.id, e.name] as [string, string]),
    inBranch,
  };
}
