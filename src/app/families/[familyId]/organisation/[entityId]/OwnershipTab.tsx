import Link from "next/link";
import type { ReactNode } from "react";
import { ConfirmRemove, SubmitButton } from "@/components/feedback";
import { Card, Chip, Field, Fold, Notice, Row, Rows, Select } from "@/components/ui";
import type { FamilyContext } from "@/lib/family-context";
import { formatDate } from "@/lib/governance";
import {
  INTERESTS,
  MANAGER_ROLES,
  PARTY_ROLES,
  TRANSACTION_KINDS,
  beneficialOwners,
  formatMoney,
  formatShares,
  holderFrom,
  holderKey,
  ownershipShares,
  registerOfMembers,
  ruleText,
  type BoRule,
  type EntityOwnership,
  type Holder,
  type ShareClass,
  type ShareTransaction,
} from "@/lib/ownership";
import { formatAddress } from "@/lib/people";
import {
  addBeneficiary,
  addBeneficiaryClass,
  addClassMember,
  addSettlement,
  addShareClass,
  approveShareTransaction,
  endBeneficiary,
  endClassMember,
  recordShareTransaction,
  removeBeneficiary,
  removeBeneficiaryClass,
  removeSettlement,
  removeShareClass,
  removeShareTransaction,
} from "../ownership-actions";
import { BeneficiaryForm, SettlementForm, ShareClassForm, ShareTransactionForm, type HolderOptions } from "./OwnershipForms";

type Row_ = Record<string, unknown>;
type Addr = { id: string; line1: string; line2: string | null; city: string; region: string | null; postal_code: string | null; country: string };
type EntityLite = { id: string; name: string; entity_type: string; registration_number: string | null; registered_on: string | null; registered_address_id: string | null; jurisdiction: string };

const SHARE_TYPES = ["company", "llc"];
const TRUST_TYPES = ["trust", "foundation"];

// The Ownership & control tab of an entity.
export async function OwnershipTab({
  ctx,
  familyId,
  entity,
  names,
  rule,
}: {
  ctx: FamilyContext;
  familyId: string;
  entity: EntityLite & { base_currency: string | null };
  names: Map<string, string>;
  rule: (BoRule & { authorised_capital?: "required" | "optional" | "none" }) | null;
}) {
  const db = ctx.db!;
  const me = ctx.user?.id ?? null;
  const shareKind = SHARE_TYPES.includes(entity.entity_type);
  const trustKind = TRUST_TYPES.includes(entity.entity_type);
  const foundation = entity.entity_type === "foundation";
  const units = entity.entity_type === "llc" ? "units" : "shares";
  // Whether the maximum number of shares must be set (from the Entity
  // Standard). With no standard, it is offered but not required.
  const authorisedCapital = rule?.authorised_capital === "required" ? "required" : rule?.authorised_capital === "none" && rule ? "none" : "optional";

  // Everything the family records about ownership, for every entity it can
  // see: needed to look through chains of entities for beneficial owners.
  const [ents, orgs, classes, txs, setts, bens, bclasses, bmembers, appts] = await Promise.all([
    db.from("entities").select("id, name, entity_type, jurisdiction, registration_number, registered_on, registered_address_id").order("name"),
    db.from("outside_organisations").select("id, name, jurisdiction, registration_number, incorporated_on, address_id").order("name"),
    db.from("share_classes").select("id, entity_id, name, currency, par_value, limited, voting, created_at").order("created_at"),
    db.from("share_transactions").select("*").order("transaction_date"),
    db.from("settlements").select("*").order("settled_on"),
    db.from("beneficiaries").select("*").order("created_at"),
    db.from("beneficiary_classes").select("id, entity_id, name, description").order("name"),
    db.from("beneficiary_class_members").select("id, entity_id, class_id, person_id, added_on, ceased_on"),
    db.from("appointments").select("entity_id, role, person_id, organisation_id, holder_entity_id, ceased_on"),
  ]);
  const entities = (ents.data ?? []) as EntityLite[];
  const organisations = (orgs.data ?? []) as { id: string; name: string; jurisdiction: string | null; registration_number: string | null; incorporated_on: string | null; address_id: string | null }[];
  const allClasses = (classes.data ?? []) as (ShareClass & { entity_id: string })[];
  const allTx = ((txs.data ?? []) as Row_[]).map((t) => ({ ...(t as unknown as ShareTransaction), entity_id: String(t.entity_id), prepared_by: t.prepared_by as string | null, edited_by: (t.edited_by as string[] | null) ?? [], updated_at: String(t.updated_at), resolution: t.resolution as string | null, consideration: t.consideration as string | null, to: holderFrom(t, "to_"), from: holderFrom(t, "from_") }));
  const allSettlements = (setts.data ?? []) as Row_[];
  const allBeneficiaries = (bens.data ?? []) as Row_[];
  const allBClasses = (bclasses.data ?? []) as { id: string; entity_id: string; name: string; description: string | null }[];
  const allMembers = (bmembers.data ?? []) as { id: string; entity_id: string; class_id: string; person_id: string; added_on: string | null; ceased_on: string | null }[];
  const allAppts = ((appts.data ?? []) as Row_[]).filter((a) => !a.ceased_on);

  const entityName = new Map(entities.map((e) => [e.id, e.name]));
  const orgName = new Map(organisations.map((o) => [o.id, o.name]));
  const nameOf = (h: Holder | null) =>
    !h ? "—" : h.kind === "person" ? (names.get(h.id) ?? "Someone you can't see") : h.kind === "entity" ? (entityName.get(h.id) ?? "An entity you can't see") : (orgName.get(h.id) ?? "An organisation");
  const link = (h: Holder | null): ReactNode => {
    if (!h) return "—";
    if (h.kind === "person" && names.has(h.id))
      return (
        <Link href={`/families/${familyId}/tree/${h.id}`} className="underline decoration-border underline-offset-4 hover:decoration-ink">
          {nameOf(h)}
        </Link>
      );
    if (h.kind === "entity" && entityName.has(h.id))
      return (
        <Link href={`/families/${familyId}/organisation/${h.id}?tab=ownership`} className="underline decoration-border underline-offset-4 hover:decoration-ink">
          {nameOf(h)}
        </Link>
      );
    return nameOf(h);
  };

  // What each entity contributes to the beneficial-owner calculation.
  const registersFor = (id: string) =>
    registerOfMembers(
      allClasses.filter((c) => c.entity_id === id),
      allTx.filter((t) => t.entity_id === id),
    );
  const graph: EntityOwnership[] = entities.map((e) => {
    const parties: EntityOwnership["parties"] = [];
    for (const s of allSettlements.filter((x) => x.entity_id === e.id)) {
      const h = holderFrom(s);
      if (h) parties.push({ holder: h, role: e.entity_type === "foundation" ? "Founder" : "Settlor" });
    }
    for (const b of allBeneficiaries.filter((x) => x.entity_id === e.id && !x.ceased_on)) {
      const h = holderFrom(b);
      if (h) parties.push({ holder: h, role: "Beneficiary" });
    }
    for (const m of allMembers.filter((x) => x.entity_id === e.id && !x.ceased_on)) {
      const cls = allBClasses.find((c) => c.id === m.class_id);
      parties.push({ holder: { kind: "person", id: m.person_id }, role: `Beneficiary (${cls?.name ?? "a class"})` });
    }
    const appts = allAppts.filter((a) => a.entity_id === e.id);
    for (const a of appts) {
      const h = holderFrom(a);
      if (h && PARTY_ROLES[String(a.role)]) parties.push({ holder: h, role: PARTY_ROLES[String(a.role)] });
    }
    return {
      id: e.id,
      name: e.name,
      entity_type: e.entity_type,
      shareholders: SHARE_TYPES.includes(e.entity_type) ? ownershipShares(registersFor(e.id)).map((o) => ({ holder: o.holder, percent: Math.max(o.percent, o.votingPercent) })) : [],
      parties,
      managers: appts.flatMap((a) => {
        const h = holderFrom(a);
        return h && MANAGER_ROLES[String(a.role)] ? [{ holder: h, role: MANAGER_ROLES[String(a.role)] }] : [];
      }),
    };
  });

  const options: HolderOptions = {
    people: [...names.entries()].sort((a, b) => a[1].localeCompare(b[1])),
    entities: entities.filter((e) => e.id !== entity.id).map((e) => [e.id, e.name] as [string, string]),
    organisations: organisations.map((o) => [o.id, o.name] as [string, string]),
  };

  const myClasses = allClasses.filter((c) => c.entity_id === entity.id);
  const myTx = allTx.filter((t) => t.entity_id === entity.id);
  const registers = registersFor(entity.id);
  const totalIssued = registers.reduce((n, r) => n + r.issued, 0);
  const shareOf = new Map(ownershipShares(registers).map((o) => [holderKey(o.holder), o.percent]));

  // Holder details for the register: entered once elsewhere, shown here.
  const needDetails = registers.flatMap((r) => r.holdings.map((h) => h.holder));
  const personIds = needDetails.filter((h) => h.kind === "person").map((h) => h.id);
  const [details, passports, homes] = personIds.length
    ? await Promise.all([
        db.from("person_details").select("person_id, date_of_birth").in("person_id", personIds),
        db.from("passports").select("person_id, country, number").in("person_id", personIds),
        db.from("person_addresses").select("person_id, kind, is_current, addresses(id, line1, line2, city, region, postal_code, country)").in("person_id", personIds),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const addressIds = [...organisations.map((o) => o.address_id), ...entities.map((e) => e.registered_address_id)].filter(Boolean) as string[];
  const { data: addrRows } = addressIds.length ? await db.from("addresses").select("id, line1, line2, city, region, postal_code, country").in("id", addressIds) : { data: [] };
  const addr = new Map(((addrRows ?? []) as Addr[]).map((a) => [a.id, a]));
  const holderDetails = (h: Holder): string[] => {
    if (h.kind === "person") {
      const dob = ((details.data ?? []) as { person_id: string; date_of_birth: string | null }[]).find((d) => d.person_id === h.id)?.date_of_birth;
      const pp = ((passports.data ?? []) as { person_id: string; country: string; number: string }[]).filter((p) => p.person_id === h.id);
      const home = ((homes.data ?? []) as { person_id: string; kind: string; is_current: boolean; addresses: Addr | Addr[] | null }[])
        .filter((a) => a.person_id === h.id && a.is_current)
        .sort((a, b) => Number(b.kind === "home") - Number(a.kind === "home"))[0];
      const a = home ? (Array.isArray(home.addresses) ? home.addresses[0] : home.addresses) : null;
      return [a ? formatAddress(a) : null, dob ? `Born ${formatDate(dob)}` : null, ...pp.map((p) => `Passport ${p.country} ${p.number}`)].filter(Boolean) as string[];
    }
    if (h.kind === "organisation") {
      const o = organisations.find((x) => x.id === h.id);
      if (!o) return [];
      const a = o.address_id ? addr.get(o.address_id) : undefined;
      return [a ? formatAddress(a) : null, o.jurisdiction, o.registration_number ? `No. ${o.registration_number}` : null, o.incorporated_on ? `Incorporated ${formatDate(o.incorporated_on)}` : null].filter(Boolean) as string[];
    }
    const e = entities.find((x) => x.id === h.id);
    if (!e) return [];
    const a = e.registered_address_id ? addr.get(e.registered_address_id) : undefined;
    return [a ? formatAddress(a) : null, e.jurisdiction, e.registration_number ? `No. ${e.registration_number}` : null, e.registered_on ? `Registered ${formatDate(e.registered_on)}` : null].filter(Boolean) as string[];
  };

  const className = new Map(myClasses.map((c) => [c.id, c.name]));
  const describe = (t: (typeof myTx)[number]) => {
    const n = `${formatShares(t.shares)} ${className.get(t.class_id) ?? ""} ${units}`;
    if (t.kind === "authorise") return `${n} authorised`;
    if (t.kind === "issue") return <>{n} issued to {link(t.to)}</>;
    return (
      <>
        {n} transferred from {link(t.from)} to {link(t.to)}
      </>
    );
  };
  const txMeta = (t: (typeof myTx)[number]) =>
    [
      formatDate(t.transaction_date),
      t.certificate_number ? `Certificate ${t.certificate_number}` : null,
      t.balance_certificate_number ? `balance certificate ${t.balance_certificate_number}` : null,
      t.consideration ? `paid ${formatMoney(t.consideration, myClasses.find((c) => c.id === t.class_id)?.currency ?? null)}` : null,
      t.resolution,
    ]
      .filter(Boolean)
      .join(" · ");

  const drafts = myTx.filter((t) => t.status === "draft");
  // Shares already in draft transfers out, so the same shares aren't offered twice.
  const pendingOut = (classId: string, h: Holder) =>
    drafts.filter((t) => t.kind === "transfer" && t.class_id === classId && t.from && holderKey(t.from) === holderKey(h)).reduce((n, t) => n + Number(t.shares), 0);
  const approved = myTx.filter((t) => t.status === "approved").reverse();
  const owners = rule ? beneficialOwners(entity.id, graph, rule) : [];

  const mySettlements = allSettlements.filter((s) => s.entity_id === entity.id);
  const myBeneficiaries = allBeneficiaries.filter((b) => b.entity_id === entity.id);
  const myBClasses = allBClasses.filter((c) => c.entity_id === entity.id);

  return (
    <>
      {shareKind && (
        <>
          <Card
            title={entity.entity_type === "llc" ? "Membership units" : "Share capital"}
            description={`Every class of ${units}, with how many are authorised and issued. Issued ${units} count once a transaction is approved.`}
          >
            {myClasses.length === 0 ? (
              <p className="border-y border-border py-3 text-ink-3">No classes recorded yet. Start with the class (e.g. Ordinary), its currency and the {units} authorised.</p>
            ) : (
              <Rows>
                {registers.map((r) => (
                  <Row
                    key={r.shareClass.id}
                    title={r.shareClass.name}
                    meta={[
                      r.shareClass.par_value !== null ? `${formatMoney(r.shareClass.par_value, r.shareClass.currency)} par value` : `${r.shareClass.currency}, no par value`,
                      r.shareClass.voting ? "Voting" : "Non-voting",
                      r.shareClass.limited ? `${formatShares(r.issued)} issued of ${formatShares(r.authorised)} authorised` : `${formatShares(r.issued)} issued (no limit)`,
                    ].join(" · ")}
                  >
                    {ctx.canEdit && <ConfirmRemove action={removeShareClass.bind(null, familyId, entity.id, r.shareClass.id)} what={`the ${r.shareClass.name} class`} />}
                  </Row>
                ))}
              </Rows>
            )}
            {ctx.canEdit && (
              <Fold label={myClasses.length ? "Add another class" : `Add a class of ${units}`}>
                <ShareClassForm
                  action={addShareClass.bind(null, familyId, entity.id)}
                  authorised={authorisedCapital}
                  units={units}
                  firstClass={myClasses.length === 0}
                  currency={entity.base_currency}
                />
              </Fold>
            )}
          </Card>

          {drafts.length > 0 && (
            <Card title="Waiting for approval" description="Recorded but not yet counted. A Manager who didn't prepare a transaction approves it, as the board or members would by minute or resolution.">
              <Rows>
                {drafts.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-[15px] font-medium text-ink">
                        <Chip>Draft</Chip> {describe(t)}
                      </div>
                      <div className="text-sm text-ink-3">{txMeta(t)}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {ctx.canManage && t.prepared_by !== me && !t.edited_by.includes(me ?? "") && (
                        <form action={approveShareTransaction.bind(null, familyId, entity.id, t.id, t.updated_at)}>
                          <SubmitButton pendingText="Approving…">Approve</SubmitButton>
                        </form>
                      )}
                      {ctx.canEdit && (t.prepared_by === me || t.edited_by.includes(me ?? "")) && (
                        <p className="text-sm text-ink-3">You recorded or changed this, so another Manager approves it.</p>
                      )}
                      {ctx.canEdit && <ConfirmRemove action={removeShareTransaction.bind(null, familyId, entity.id, t.id)} what="this draft transaction" />}
                    </div>
                  </li>
                ))}
              </Rows>
            </Card>
          )}

          <Card title="Register of members" description={`Who holds the ${units} today, worked out from the approved transactions. Details come from each holder's own record.`}>
            {registers.every((r) => r.holdings.length === 0) ? (
              <p className="border-y border-border py-3 text-ink-3">No {units} issued yet.</p>
            ) : (
              <div className="space-y-6">
                {registers
                  .filter((r) => r.holdings.length)
                  .map((r) => (
                    <div key={r.shareClass.id}>
                      <h3 className="mb-2 font-semibold text-ink">
                        {r.shareClass.name} {units} · {formatShares(r.holdings.reduce((n, h) => n + h.shares, 0))} in issue
                      </h3>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[640px] border-y border-border text-left text-sm">
                          <thead className="text-ink-3">
                            <tr>
                              <th scope="col" className="py-2 pr-4 font-medium">Member</th>
                              <th scope="col" className="py-2 pr-4 font-medium">Certificates</th>
                              <th scope="col" className="py-2 pr-4 text-right font-medium">{units === "units" ? "Units" : "Shares"}</th>
                              <th scope="col" className="py-2 pr-4 text-right font-medium">Nominal value</th>
                              <th scope="col" className="py-2 text-right font-medium">Of all issued</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {r.holdings.map((h) => (
                              <tr key={holderKey(h.holder)} className="align-top">
                                <td className="py-3 pr-4">
                                  <span className="block text-[15px] font-medium text-ink">{link(h.holder)}</span>
                                  {holderDetails(h.holder).map((d) => (
                                    <span key={d} className="block text-ink-3">
                                      {d}
                                    </span>
                                  ))}
                                </td>
                                <td className="py-3 pr-4 text-ink-2">{h.certificates.map((c) => `No. ${c.number} (${formatShares(c.shares)})`).join(", ") || "—"}</td>
                                <td className="py-3 pr-4 text-right text-ink">{formatShares(h.shares)}</td>
                                <td className="py-3 pr-4 text-right text-ink-2">
                                  {r.shareClass.par_value !== null ? formatMoney(Number(r.shareClass.par_value) * h.shares, r.shareClass.currency) : "No par value"}
                                </td>
                                <td className="py-3 text-right text-ink-2">{totalIssued ? `${Math.round((shareOf.get(holderKey(h.holder)) ?? 0) * 100) / 100}%` : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </Card>

          <Card title="Share transactions" description="The approved record, newest first. An approved transaction can't be changed: a mistake is put right by recording another one.">
            {approved.length === 0 ? (
              <p className="border-y border-border py-3 text-ink-3">None approved yet.</p>
            ) : (
              <Rows>
                {approved.map((t) => (
                  <Row key={t.id} title={<>{TRANSACTION_KINDS[t.kind]}: {describe(t)}</>} meta={txMeta(t)} />
                ))}
              </Rows>
            )}
            {ctx.canEdit &&
              (myClasses.length ? (
                <Fold label="Record a transaction">
                  <ShareTransactionForm
                    action={recordShareTransaction.bind(null, familyId, entity.id)}
                    classes={myClasses.map((c) => [c.id, `${c.name} (${c.currency})`] as [string, string])}
                    options={options}
                    units={units}
                    canAuthorise={myClasses.some((c) => c.limited)}
                    holders={Object.fromEntries(
                      registers.map((r) => [
                        r.shareClass.id,
                        r.holdings.map((h) => ({
                          value: `${h.holder.kind}:${h.holder.id}`,
                          name: nameOf(h.holder),
                          available: h.shares - pendingOut(r.shareClass.id, h.holder),
                        })),
                      ]),
                    )}
                    firstKind={registers.some((r) => r.authorised > 0 || !r.shareClass.limited) ? "issue" : "authorise"}
                  />
                </Fold>
              ) : (
                <p className="mt-3 text-sm text-ink-3">Add a class first; then transactions can be recorded.</p>
              ))}
          </Card>
        </>
      )}

      {trustKind && (
        <>
          <Card
            title={foundation ? "Founder and endowments" : "Settlors and settlements"}
            description={foundation ? "Who founded the foundation, and what was given to it, including later additions." : "Who settled the trust, and what was settled, including later additions to the capital."}
          >
            {mySettlements.length === 0 ? (
              <p className="border-y border-border py-3 text-ink-3">None recorded yet.</p>
            ) : (
              <Rows>
                {mySettlements.map((s) => (
                  <Row
                    key={String(s.id)}
                    title={link(holderFrom(s))}
                    meta={[
                      s.kind === "initial" ? (foundation ? "Founder's endowment" : "First settlement") : "Addition to the capital",
                      formatDate(s.settled_on as string | null),
                      s.description as string | null,
                      formatMoney(s.amount as string | null, s.currency as string | null),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    {ctx.canEdit && <ConfirmRemove action={removeSettlement.bind(null, familyId, entity.id, String(s.id))} what="this settlement" />}
                  </Row>
                ))}
              </Rows>
            )}
            {ctx.canEdit && (
              <Fold label={foundation ? "Record the founder or an endowment" : "Record a settlement"}>
                <SettlementForm action={addSettlement.bind(null, familyId, entity.id)} options={options} foundation={foundation} currency={entity.base_currency} />
              </Fold>
            )}
          </Card>

          <Card title="Beneficiaries" description="Named beneficiaries and charitable causes. Classes of beneficiaries are below.">
            {myBeneficiaries.filter((b) => !b.ceased_on).length === 0 ? (
              <p className="border-y border-border py-3 text-ink-3">No named beneficiaries recorded.</p>
            ) : (
              <Rows>
                {myBeneficiaries
                  .filter((b) => !b.ceased_on)
                  .map((b) => (
                    <Row
                      key={String(b.id)}
                      title={b.cause ? `Charitable cause: ${String(b.cause)}` : link(holderFrom(b))}
                      meta={[
                        INTERESTS[b.interest as keyof typeof INTERESTS],
                        b.share_percent ? `${Number(b.share_percent)}%` : null,
                        b.added_on ? `Since ${formatDate(b.added_on as string)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    >
                      {ctx.canEdit && <ConfirmRemove action={endBeneficiary.bind(null, familyId, entity.id, String(b.id))} what={b.cause ? "this cause" : nameOf(holderFrom(b))} label="End" />}
                    </Row>
                  ))}
              </Rows>
            )}
            {myBeneficiaries.some((b) => b.ceased_on) && (
              <Fold label="Past beneficiaries">
                <Rows>
                  {myBeneficiaries
                    .filter((b) => b.ceased_on)
                    .map((b) => (
                      <Row key={String(b.id)} title={b.cause ? String(b.cause) : link(holderFrom(b))} meta={`Until ${formatDate(b.ceased_on as string)}`}>
                        {ctx.canEdit && <ConfirmRemove action={removeBeneficiary.bind(null, familyId, entity.id, String(b.id))} what="this past beneficiary" />}
                      </Row>
                    ))}
                </Rows>
              </Fold>
            )}
            {ctx.canEdit && (
              <Fold label="Add a beneficiary">
                <BeneficiaryForm action={addBeneficiary.bind(null, familyId, entity.id)} options={options} interests={Object.entries(INTERESTS)} />
              </Fold>
            )}
          </Card>

          <Card title="Classes of beneficiaries" description='A class such as "the descendants of Tom Hartley", with the people in it today.'>
            {myBClasses.length === 0 ? (
              <p className="border-y border-border py-3 text-ink-3">No classes recorded.</p>
            ) : (
              <div className="space-y-5">
                {myBClasses.map((c) => {
                  const members = allMembers.filter((m) => m.class_id === c.id && !m.ceased_on);
                  return (
                    <div key={c.id} className="border-t border-border pt-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-semibold text-ink">{c.name}</h3>
                        {ctx.canEdit && <ConfirmRemove action={removeBeneficiaryClass.bind(null, familyId, entity.id, c.id)} what={`the class ${c.name}`} />}
                      </div>
                      {c.description && <p className="text-sm text-ink-2">{c.description}</p>}
                      {members.length === 0 ? (
                        <p className="py-2 text-sm text-ink-3">Nobody in this class yet.</p>
                      ) : (
                        <ul className="mt-1 divide-y divide-border">
                          {members.map((m) => (
                            <Row key={m.id} title={link({ kind: "person", id: m.person_id })} meta={m.added_on ? `Since ${formatDate(m.added_on)}` : undefined}>
                              {ctx.canEdit && <ConfirmRemove action={endClassMember.bind(null, familyId, entity.id, m.id)} what={`${nameOf({ kind: "person", id: m.person_id })} from ${c.name}`} label="Take out" />}
                            </Row>
                          ))}
                        </ul>
                      )}
                      {ctx.canEdit && (
                        <Fold label={`Add someone to ${c.name}`}>
                          <form action={addClassMember.bind(null, familyId, entity.id, c.id)} className="space-y-4">
                            <div className="grid gap-4 sm:grid-cols-2">
                              <Select id={`person-${c.id}`} label="Person" name="person_id" required includeBlank="Choose…" options={options.people.filter(([id]) => !members.some((m) => m.person_id === id))} />
                              <Field id={`added-${c.id}`} label="In the class since" name="added_on" type="date" />
                            </div>
                            <SubmitButton pendingText="Adding…">Add to the class</SubmitButton>
                          </form>
                        </Fold>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {ctx.canEdit && (
              <Fold label="Add a class of beneficiaries">
                <form action={addBeneficiaryClass.bind(null, familyId, entity.id)} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="bclass_name" label="Name of the class" name="name" required hint="e.g. The descendants of Tom Hartley" />
                    <Field id="bclass_description" label="Description, as in the deed" name="description" />
                  </div>
                  <SubmitButton pendingText="Adding…">Add class</SubmitButton>
                </form>
              </Fold>
            )}
          </Card>
        </>
      )}

      {!shareKind && !trustKind && (
        <Notice>Partners and members are recorded on the Officers &amp; appointments tab. They are counted as owners below.</Notice>
      )}

      <Card
        title="Beneficial owners"
        description={
          rule && trustKind ? (
            "For a trust or foundation everyone with a role counts: settlors or founders, trustees or council members, protectors, enforcers and beneficiaries (named, and the members of each class). Check it before anything is filed."
          ) : rule ? (
            <>
              Worked out from what is recorded, under the rule in the Entity Standard: {ruleText(rule)}. Holdings through the family&apos;s own entities are followed
              through. Check it before anything is filed.
            </>
          ) : (
            "No Entity Standard applies, so the beneficial ownership rule isn't known."
          )
        }
      >
        {rule &&
          (owners.length === 0 ? (
            <p className="border-y border-border py-3 text-ink-3">Nobody can be worked out yet: record the {shareKind ? "shareholders and directors" : "settlors, beneficiaries and officers"} first.</p>
          ) : (
            <Rows>
              {owners.map((o) => (
                <Row
                  key={holderKey(o.holder)}
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {link(o.holder)}
                      {o.percent !== null && <span className="text-ink-2">{Math.round(o.percent * 100) / 100}%</span>}
                      {o.outside && <Chip>Outside organisation: its owners aren&apos;t recorded here</Chip>}
                      {o.fallback && <Chip>Senior managing official</Chip>}
                      {o.unresolved && <Chip>Can&apos;t be looked through: its owners aren&apos;t recorded, or aren&apos;t visible to you</Chip>}
                    </span>
                  }
                  meta={o.reasons.join(" · ")}
                />
              ))}
            </Rows>
          ))}
      </Card>
    </>
  );
}
