import "server-only";
import { APPOINTMENT_ROLES, ENTITY_TYPES, type AppointmentRole, type EntityType } from "@/lib/entity-checklist";
import type { FamilyContext } from "@/lib/family-context";
import { PROFESSIONS } from "@/lib/governance";
import { ownershipShares } from "@/lib/ownership";
import { Masker, fold } from "@/lib/placeholders";
import { displayNames, type PersonSummary } from "@/lib/people";
import { loadOrganisationData } from "../organisation/organisation-data";

// What the Elder is told about the family: only what the person asking may
// already see (every read runs as them), with every name replaced by a
// placeholder. Dates of birth, addresses, ID, tax and account numbers, and
// free text (notes, titles, descriptions) are never included; what is sent
// is also scrubbed of numbers, dates, postcodes and email addresses.

type Person = PersonSummary & { member_type: string; branch_id: string | null; deceased: boolean; maiden_name: string | null };

export async function elderContext(ctx: FamilyContext, m: Masker) {
  const db = ctx.db!;
  const [{ data: peopleRows }, { data: branchRows }, { data: pc }, { data: partners }, data, { data: bodies }, { data: seats }, { data: stmts }, { data: advisors }, { data: roles }, { data: risks }] =
    await Promise.all([
      db.from("people").select("id, full_names, surname, maiden_name, known_as, birth_year, member_type, branch_id, deceased"),
      db.from("branches").select("id, name, head_person_id"),
      db.from("parent_child").select("parent_id, child_id, kind"),
      db.from("partnerships").select("person_a, person_b, kind, end_date, end_reason"),
      loadOrganisationData(ctx),
      db.from("governance_bodies").select("id, kind, name, branch_id"),
      db.from("body_members").select("body_id, person_id, role, to_date"),
      db.from("family_statements").select("kind, title, status, branch_id"),
      db.from("advisors").select("id, full_name, firm, profession"),
      db.from("advisor_roles").select("advisor_id, branch_id, advises_on, to_date"),
      ctx.canEdit ? db.from("risks").select("category, status") : Promise.resolve({ data: [] }),
    ]);
  const { data: orgContacts } = await db.from("outside_organisations").select("id, contact_name");

  const people = (peopleRows ?? []) as Person[];
  const names = displayNames(people);
  m.add("Family", "family", ctx.family.name.replace(/\s+family$/i, ""));
  const parts = (n: string | null | undefined) => (n ?? "").split(/[\s-]+/).filter((x) => x.length >= 2);
  // Placeholders for people first, with every part of their names.
  const P = new Map<string, string>();
  for (const p of people) {
    const full = `${p.full_names} ${p.surname}`.trim();
    const variants = [names.get(p.id) ?? "", ...parts(p.full_names), p.surname, p.maiden_name ?? "", p.known_as ?? "", p.known_as ? `${p.known_as} ${p.surname}` : "", p.maiden_name ? `${p.full_names} ${p.maiden_name}` : ""].filter(Boolean);
    P.set(p.id, m.add("Person", p.id, full, variants) ?? "[a person]");
  }
  // The person asking, in case they aren't in the Tree (e.g. Turnstone staff).
  if (!people.some((p) => fold(`${p.full_names} ${p.surname}`).toLowerCase() === fold(ctx.displayName).toLowerCase()))
    m.add("Person", "me", ctx.displayName, parts(ctx.displayName));
  const B = new Map(((branchRows ?? []) as { id: string; name: string }[]).map((b) => [b.id, m.add("Branch", b.id, b.name) ?? "[a branch]"]));
  const E = new Map(data.entities.map((e) => [e.id, m.add("Entity", e.id, e.name) ?? "[an entity]"]));
  const F = new Map(data.organisations.map((o) => [o.id, m.add("Firm", o.id, o.name, [o.name.replace(/\b(Ltd|Limited|LLP|plc|Inc|SA|AG|BV|NV)\.?$/i, "").trim(), o.name.replace(/&/g, "and")]) ?? "[a firm]"]));
  for (const o of (orgContacts ?? []) as { id: string; contact_name: string | null }[])
    if (o.contact_name) m.add("Person", `contact:${o.id}`, o.contact_name, parts(o.contact_name).filter((x) => !/^(mr|mrs|ms|miss|dr|prof)\.?$/i.test(x)));
  const holder = (h: { kind: string; id: string } | null) => (!h ? "someone" : h.kind === "person" ? (P.get(h.id) ?? "someone") : h.kind === "entity" ? (E.get(h.id) ?? "an entity") : (F.get(h.id) ?? "a firm"));
  const decade = (y: number | null) => (y ? `born in the ${Math.floor(y / 10) * 10}s` : null);

  const out: string[] = [];
  out.push(`FAMILY: [Family]`);
  out.push(`\nPEOPLE (${people.length}):`);
  for (const p of people)
    out.push(`- ${P.get(p.id)}: ${p.member_type.replace(/_/g, " ")}${p.branch_id ? `, ${B.get(p.branch_id)}` : ""}${decade(p.birth_year) ? `, ${decade(p.birth_year)}` : ""}${p.deceased ? ", deceased" : ""}`);
  const rel: string[] = [];
  for (const r of (pc ?? []) as { parent_id: string; child_id: string; kind: string }[])
    if (P.has(r.parent_id) && P.has(r.child_id)) rel.push(`- ${P.get(r.parent_id)} is ${r.kind === "birth" ? "a parent" : `a ${r.kind} parent`} of ${P.get(r.child_id)}`);
  for (const r of (partners ?? []) as { person_a: string; person_b: string; kind: string; end_date: string | null; end_reason: string | null }[])
    if (P.has(r.person_a) && P.has(r.person_b)) rel.push(`- ${P.get(r.person_a)} and ${P.get(r.person_b)}: ${r.kind.replace(/_/g, " ")}${r.end_date ? ` (ended${r.end_reason ? `: ${r.end_reason}` : ""})` : ""}`);
  if (rel.length) out.push(`\nFAMILY LINKS:`, ...rel);
  if (B.size) {
    out.push(`\nBRANCHES:`);
    for (const b of (branchRows ?? []) as { id: string; head_person_id: string | null }[]) out.push(`- ${B.get(b.id)}${b.head_person_id && P.has(b.head_person_id) ? `, headed by ${P.get(b.head_person_id)}` : ""}`);
  }
  if (data.entities.length) {
    out.push(`\nENTITIES:`);
    for (const e of data.entities) {
      out.push(`- ${E.get(e.id)}: ${ENTITY_TYPES[e.entity_type as EntityType] ?? e.entity_type} (${e.sub_type}), ${e.jurisdiction}${e.status === "dissolved" ? ", dissolved" : ""}${e.registered_on ? `, formed ${e.registered_on.slice(0, 4)}` : ""}`);
      for (const a of data.appointments.filter((x) => x.entity_id === e.id && !x.ceased_on && x.holder))
        out.push(`  - ${APPOINTMENT_ROLES[a.role as AppointmentRole] ?? a.role}: ${holder(a.holder)}`);
      for (const o of ownershipShares(data.registersFor(e.id))) out.push(`  - owns ${o.percent.toFixed(1)}% of the shares: ${holder(o.holder)}`);
      for (const b of data.beneficiaries.filter((x) => (x as { entity_id: string }).entity_id === e.id) as unknown as { person_id: string | null; organisation_id: string | null; holder_entity_id: string | null; cause: string | null; ceased_on: string | null; interest: string }[])
        if (!b.ceased_on)
          out.push(`  - beneficiary (${b.interest}): ${b.cause ? "a charitable cause" : holder(b.person_id ? { kind: "person", id: b.person_id } : b.organisation_id ? { kind: "organisation", id: b.organisation_id } : { kind: "entity", id: b.holder_entity_id! })}`);
      (data.beneficiaryClasses.filter((x) => (x as { entity_id: string }).entity_id === e.id) as unknown as { id: string }[]).forEach((c, i) => {
        const members = (data.classMembers as unknown as { class_id: string; person_id: string; ceased_on: string | null }[]).filter((x) => x.class_id === c.id && !x.ceased_on);
        out.push(`  - class of beneficiaries ${i + 1}: ${members.map((x) => P.get(x.person_id) ?? "someone").join(", ") || "no members recorded"}`);
      });
    }
  }
  const bodyList = (bodies ?? []) as { id: string; kind: string; name: string; branch_id: string | null }[];
  if (bodyList.length) {
    out.push(`\nGOVERNANCE BODIES:`);
    for (const g of bodyList) {
      const members = ((seats ?? []) as { body_id: string; person_id: string; role: string; to_date: string | null }[]).filter((s) => s.body_id === g.id && !s.to_date);
      out.push(`- ${g.kind.replace(/_/g, " ")}${g.branch_id ? ` of ${B.get(g.branch_id)}` : ""}: ${members.map((s) => `${P.get(s.person_id) ?? "someone"} (${s.role.replace(/_/g, " ")})`).join(", ") || "no members recorded"}`);
    }
  }
  const adopted = ((stmts ?? []) as { kind: string; title: string; status: string; branch_id: string | null }[]).filter((s) => s.status === "adopted");
  if (adopted.length) out.push(`\nADOPTED STATEMENTS:`, ...adopted.map((s) => `- a statement of ${s.kind}${s.branch_id ? ` (${B.get(s.branch_id)})` : " (the whole family)"}`));
  const adv = (advisors ?? []) as { id: string; full_name: string; firm: string | null; profession: string }[];
  if (adv.length) {
    out.push(`\nADVISORS:`);
    for (const a of adv) {
      const label = m.add("Person", `advisor:${a.id}`, a.full_name, parts(a.full_name).filter((x) => !/^(mr|mrs|ms|miss|dr|prof)\.?$/i.test(x))) ?? "an advisor";
      if (a.firm) m.add("Firm", `advisor-firm:${a.id}`, a.firm, [a.firm.replace(/&/g, "and")]);
      const r = ((roles ?? []) as { advisor_id: string; branch_id: string | null; advises_on: string; to_date: string | null }[]).filter((x) => x.advisor_id === a.id && !x.to_date);
      out.push(`- ${label}, ${PROFESSIONS[a.profession as keyof typeof PROFESSIONS] ?? a.profession}: ${r.map((x) => (x.branch_id ? `in the circle of ${B.get(x.branch_id)}` : "in the family's circle")).join("; ") || "no current role"}`);
    }
  }
  const openRisks = ((risks ?? []) as { category: string; status: string }[]).filter((r) => r.status === "open");
  if (openRisks.length) {
    const by = new Map<string, number>();
    for (const r of openRisks) by.set(r.category, (by.get(r.category) ?? 0) + 1);
    out.push(`\nOPEN RISKS (number in each category):`, ...[...by.entries()].map(([c, n]) => `- ${c.replace(/_/g, " ")}: ${n}`));
  }

  return Masker.scrubNumbers(m.mask(out.join("\n")));
}

// Exactly what is sent for a question: the records and the question, with
// placeholders, and the masker that puts the names back in the answer.
export async function whatWillBeSent(ctx: FamilyContext, question: string) {
  const m = new Masker();
  const records = await elderContext(ctx, m);
  const masked = Masker.scrubNumbers(m.mask(question));
  return { m, records, masked };
}
