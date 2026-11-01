import Link from "next/link";
import type { ReactNode } from "react";
import { ConfirmRemove, SubmitButton } from "@/components/feedback";
import { Card, Facts, Field, Notice, Select } from "@/components/ui";
import type { FamilyContext } from "@/lib/family-context";
import {
  siblingKinds,
  ADDRESS_KINDS,
  MEMBER_TYPES,
  PARENT_KINDS,
  PARTNERSHIP_END_REASONS,
  PARTNERSHIP_KINDS,
  RELATIONSHIP_TO_WEALTH,
  SEX_OPTIONS,
  THREE_CIRCLE_ROLES,
  formatAddress,
} from "@/lib/people";
import { PersonFields } from "../PersonFields";
import { RelationshipForm } from "./RelationshipForm";
import {
  addAddress,
  addLink,
  addPassport,
  addPhone,
  addTaxNumber,
  removeParentLink,
  removePartnership,
  removePassport,
  removePerson,
  removePersonAddress,
  removePhone,
  removeTaxNumber,
  saveDetails,
  updatePerson,
} from "../actions";

type Person = {
  id: string;
  full_names: string;
  surname: string;
  maiden_name: string | null;
  known_as: string | null;
  birth_year: number | null;
  deceased: boolean;
  member_type: keyof typeof MEMBER_TYPES;
  three_circle_role: keyof typeof THREE_CIRCLE_ROLES | null;
  branch_id: string | null;
  user_id: string | null;
};

type Props = {
  ctx: FamilyContext;
  familyId: string;
  personId: string;
  person: Person;
  everyone: Person[];
  names: Map<string, string>;
};

function label<T extends Record<string, string>>(map: T, key: string | null | undefined) {
  return key && key in map ? map[key as keyof T] : null;
}

function formatDate(d: string | null | undefined) {
  if (!d) return null;
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

// A "Remove" button for one row, shown to Managers only. It asks first.
function RemoveButton({ action, what }: { action: () => Promise<void>; what: string }) {
  return <ConfirmRemove action={action} what={what} />;
}

function PrivateNote({ ctx }: { ctx: FamilyContext }) {
  if (ctx.canEdit) return null;
  return (
    <Notice>
      Personal details are only shown to the family&apos;s Managers and Administrators, and to the person themself.
    </Notice>
  );
}

export function LaterTab({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card title={title}>
      <p className="text-ink">{children}</p>
    </Card>
  );
}

// ---------------------------------------------------------------------------

export async function OverviewTab({ ctx, familyId, personId, person }: Props) {
  const [{ data: branches }, { data: details }] = await Promise.all([
    ctx.db!.from("branches").select("id, name").order("name"),
    // The full date is private: only editors (and the person themself) get it back.
    ctx.db!.from("person_details").select("date_of_birth").eq("person_id", personId).maybeSingle(),
  ]);
  const branchName = (branches ?? []).find((b: { id: string }) => b.id === person.branch_id)?.name;
  const dob: string | null = details?.date_of_birth ?? null;

  return (
    <>
      <Card title="Overview">
        <Facts
          items={[
            ["Full names", person.full_names],
            ["Surname", person.surname],
            ["Maiden name", person.maiden_name],
            ["Known as", person.known_as],
            ["Type of member", MEMBER_TYPES[person.member_type]],
            ["Date of birth", dob ? formatDate(dob) : person.birth_year ? `${person.birth_year} (day and month not known)` : null],
            ["Three circle role", label(THREE_CIRCLE_ROLES, person.three_circle_role)],
            ["Branch", branchName],
            ["Deceased", person.deceased ? "Yes" : "No"],
            ["Uses the family portal", person.user_id ? "Yes" : "No"],
          ]}
        />
      </Card>

      {ctx.canEdit && (
        <Card title="Edit overview">
          <form action={updatePerson.bind(null, familyId, personId)} className="space-y-5">
            <PersonFields values={{ ...person, date_of_birth: dob }} branches={branches ?? []} canChooseBranch={ctx.canManage} />
            <SubmitButton>Save changes</SubmitButton>
          </form>
        </Card>
      )}

      {ctx.canManage && (
        <Card title="Remove this person">
          <p className="text-ink">
            This removes the person and their personal details, addresses, documents and family links. The change is
            recorded in the history. It can&apos;t be undone from here.
          </p>
          <div className="mt-4">
            <ConfirmRemove action={removePerson.bind(null, familyId, personId)} what={`${person.known_as || person.full_names} from the Tree`} />
          </div>
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

export async function IdentityTab({ ctx, familyId, personId, person }: Props) {
  const db = ctx.db!;
  const [{ data: details }, { data: passports }] = await Promise.all([
    db.from("person_details").select("*").eq("person_id", personId).maybeSingle(),
    db.from("passports").select("id, country, number, expires_on").eq("person_id", personId).order("expires_on"),
  ]);
  const d = details ?? {};
  const canSee = ctx.canEdit || details || (passports ?? []).length > 0;

  return (
    <>
      <PrivateNote ctx={ctx} />
      {canSee && (
        <Card title="Birth and personal details">
          <Facts
            items={[
              [
                "Date of birth",
                formatDate(d.date_of_birth) ?? (person.birth_year ? `${person.birth_year} (day and month not known)` : null),
              ],
              ["Place of birth", [d.city_of_birth, d.country_of_birth].filter(Boolean).join(", ")],
              ["Sex", label(SEX_OPTIONS, d.sex)],
              ["Email", d.email],
              ["Date of death", formatDate(d.date_of_death)],
              ["Relationship to wealth", label(RELATIONSHIP_TO_WEALTH, d.relationship_to_wealth)],
              ["Psychometric consent date", formatDate(d.psychometric_consent_date)],
            ]}
          />
        </Card>
      )}

      {ctx.canEdit && (
        <Card title="Edit personal details">
          <p className="mb-4 text-sm text-ink">
            The date of birth is changed under{" "}
            <Link href={`/families/${familyId}/tree/${personId}?tab=overview`} className="underline">
              Overview
            </Link>
            , so it is only entered once.
          </p>
          <form action={saveDetails.bind(null, familyId, personId)} className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Select label="Sex" name="sex" options={SEX_OPTIONS} defaultValue={d.sex ?? "unspecified"} />
              <Field label="Town or city of birth" name="city_of_birth" defaultValue={d.city_of_birth} />
              <Field label="Country of birth" name="country_of_birth" defaultValue={d.country_of_birth} />
              <Field label="Email" name="email" type="email" defaultValue={d.email} />
              <Field label="Date of death" name="date_of_death" type="date" defaultValue={d.date_of_death} />
              <Select
                label="Relationship to wealth"
                name="relationship_to_wealth"
                options={RELATIONSHIP_TO_WEALTH}
                defaultValue={d.relationship_to_wealth}
                includeBlank="Not recorded"
              />
              <Field label="Psychometric consent date" name="psychometric_consent_date" type="date" defaultValue={d.psychometric_consent_date} />
            </div>
            <SubmitButton>Save personal details</SubmitButton>
          </form>
        </Card>
      )}

      {canSee && (
        <Card title="Passports">
          {(passports ?? []).length === 0 ? (
            <p className="text-ink">No passports recorded.</p>
          ) : (
            <ul className="divide-y divide-border">
              {(passports ?? []).map((p: { id: string; country: string; number: string; expires_on: string | null }) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span className="text-ink">
                    {p.country} · {p.number}
                    {p.expires_on ? ` · expires ${formatDate(p.expires_on)}` : ""}
                  </span>
                  {ctx.canManage && (
                    <RemoveButton action={removePassport.bind(null, familyId, personId, p.id)} what={`passport ${p.number}`} />
                  )}
                </li>
              ))}
            </ul>
          )}
          {ctx.canEdit && (
            <form action={addPassport.bind(null, familyId, personId)} className="mt-4 grid gap-4 sm:grid-cols-4 sm:items-end">
              <Field label="Country" name="country" required />
              <Field label="Number" name="number" required />
              <Field label="Expires" name="expires_on" type="date" />
              <SubmitButton variant="secondary">Add passport</SubmitButton>
            </form>
          )}
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

export async function AddressesTab({ ctx, familyId, personId }: Props) {
  const db = ctx.db!;
  const [{ data: links }, { data: phones }, { data: allAddresses }] = await Promise.all([
    db
      .from("person_addresses")
      .select("id, kind, is_current, addresses(id, line1, line2, city, region, postal_code, country)")
      .eq("person_id", personId),
    db.from("phone_numbers").select("id, label, number").eq("person_id", personId).order("created_at"),
    ctx.canEdit ? db.from("addresses").select("id, line1, line2, city, region, postal_code, country").order("city") : { data: [] },
  ]);
  const { data: details } = await db.from("person_details").select("email").eq("person_id", personId).maybeSingle();
  const canSee = ctx.canEdit || (links ?? []).length > 0 || (phones ?? []).length > 0 || details;

  type Addr = { id: string; line1: string; line2: string | null; city: string; region: string | null; postal_code: string | null; country: string };

  return (
    <>
      <PrivateNote ctx={ctx} />
      {canSee && (
        <Card title="Addresses">
          {(links ?? []).length === 0 ? (
            <p className="text-ink">No addresses recorded.</p>
          ) : (
            <ul className="divide-y divide-border">
              {(links ?? []).map((l: { id: string; kind: string; addresses: Addr | Addr[] | null }) => {
                const a = Array.isArray(l.addresses) ? l.addresses[0] : l.addresses;
                return (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span className="text-ink">
                    <strong>{label(ADDRESS_KINDS, l.kind)}:</strong> {a ? formatAddress(a) : "—"}
                  </span>
                  {ctx.canManage && (
                    <RemoveButton action={removePersonAddress.bind(null, familyId, personId, l.id)} what="this address" />
                  )}
                </li>
                );
              })}
            </ul>
          )}

          {ctx.canEdit && (
            <form action={addAddress.bind(null, familyId, personId)} className="mt-6 space-y-4">
              <h3 className="font-semibold text-ink">Add an address</h3>
              <p className="text-sm text-ink">
                Choose an address the family already has, or type a new one. A new address that matches an existing one
                is reused, so it&apos;s never stored twice.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  label="Existing address"
                  name="address_id"
                  options={(allAddresses ?? []).map((a: Addr) => [a.id, formatAddress(a)] as [string, string])}
                  includeBlank="— Type a new address below —"
                />
                <Select label="Used as" name="kind" options={ADDRESS_KINDS} defaultValue="home" />
                <Field label="First line" name="line1" />
                <Field label="Second line" name="line2" />
                <Field label="Town or city" name="city" />
                <Field label="County, state or region" name="region" />
                <Field label="Postcode" name="postal_code" />
                <Field label="Country" name="country" />
              </div>
              <SubmitButton variant="secondary">Add address</SubmitButton>
            </form>
          )}
        </Card>
      )}

      {canSee && (
        <Card title="Contact details">
          <Facts items={[["Email", details?.email ?? null]]} />
          <h3 className="mt-4 font-semibold text-ink">Telephone numbers</h3>
          {(phones ?? []).length === 0 ? (
            <p className="text-ink">None recorded.</p>
          ) : (
            <ul className="divide-y divide-border">
              {(phones ?? []).map((p: { id: string; label: string; number: string }) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span className="text-ink">
                    {p.label}: {p.number}
                  </span>
                  {ctx.canManage && <RemoveButton action={removePhone.bind(null, familyId, personId, p.id)} what={`phone ${p.number}`} />}
                </li>
              ))}
            </ul>
          )}
          {ctx.canEdit && (
            <form action={addPhone.bind(null, familyId, personId)} className="mt-4 grid gap-4 sm:grid-cols-3 sm:items-end">
              <Field label="Label" name="label" defaultValue="Mobile" />
              <Field label="Number" name="number" type="tel" required />
              <SubmitButton variant="secondary">Add number</SubmitButton>
            </form>
          )}
          <p className="mt-4 text-sm text-ink">The email address is edited under Identity.</p>
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

type Kin = { key: string; personId: string; description: string; remove?: () => Promise<void>; removeWhat?: string };

function KinGroup({ title, rows, empty, familyId, name, canManage, note }: {
  title: string;
  rows: Kin[];
  empty: string;
  familyId: string;
  name: (id: string) => string;
  canManage: boolean;
  note?: string;
}) {
  return (
    <div>
      <h3 className="font-semibold text-ink">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-1 text-ink">{empty}</p>
      ) : (
        <ul className="mt-1 divide-y divide-border">
          {rows.map((r) => (
            <li key={r.key} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <span className="text-ink">
                <Link href={`/families/${familyId}/tree/${r.personId}?tab=relationships`} className="inline-flex min-h-11 items-center font-medium underline">
                  {name(r.personId)}
                </Link>{" "}
                · {r.description}
              </span>
              {canManage && r.remove && <RemoveButton action={r.remove} what={r.removeWhat ?? "this link"} />}
            </li>
          ))}
        </ul>
      )}
      {note && rows.length > 0 && <p className="mt-1 text-sm text-ink">{note}</p>}
    </div>
  );
}

type PartnerRow = { id: string; person_a: string; person_b: string; kind: string; start_date: string | null; end_date: string | null; end_reason: string | null };

export async function RelationshipsTab({ ctx, familyId, personId, person, everyone, names }: Props) {
  const db = ctx.db!;
  const [{ data: parentLinks }, { data: childLinks }, { data: allPartners }] = await Promise.all([
    db.from("parent_child").select("id, parent_id, kind").eq("child_id", personId),
    db.from("parent_child").select("id, child_id, kind").eq("parent_id", personId),
    // Every partnership this user can see: needed to suggest a second parent.
    db.from("partnerships").select("id, person_a, person_b, kind, start_date, end_date, end_reason").order("start_date", { nullsFirst: false }),
  ]);
  const parents = (parentLinks ?? []) as { id: string; parent_id: string; kind: string }[];
  const children = (childLinks ?? []) as { id: string; child_id: string; kind: string }[];
  const partnerships = (allPartners ?? []) as PartnerRow[];
  const mine = partnerships.filter((l) => l.person_a === personId || l.person_b === personId);

  // Brothers and sisters are worked out from shared parents, never typed in.
  const parentIds = parents.map((l) => l.parent_id);
  const { data: viaParents } = parentIds.length
    ? await db.from("parent_child").select("child_id").in("parent_id", parentIds).neq("child_id", personId)
    : { data: [] };
  const siblingIds = [...new Set(((viaParents ?? []) as { child_id: string }[]).map((l) => l.child_id))];
  const { data: siblingParentLinks } = siblingIds.length
    ? await db.from("parent_child").select("parent_id, child_id, kind").in("child_id", siblingIds)
    : { data: [] };
  const siblingRowsRaw = siblingKinds(
    parents.map((l) => ({ parent_id: l.parent_id, kind: l.kind })),
    (siblingParentLinks ?? []) as { parent_id: string; child_id: string; kind: string }[],
  );

  const name = (id: string) => names.get(id) ?? "Someone you can't see";
  const kindOf = (k: string) => label(PARENT_KINDS, k) ?? "";

  const parentRows: Kin[] = parents.map((l) => ({
    key: l.id,
    personId: l.parent_id,
    description: `${kindOf(l.kind)} parent`,
    remove: removeParentLink.bind(null, familyId, personId, l.id),
    removeWhat: `the link to ${name(l.parent_id)}`,
  }));
  const partnerRows: Kin[] = mine.map((l) => {
    const other = l.person_a === personId ? l.person_b : l.person_a;
    const bits = [
      label(PARTNERSHIP_KINDS, l.kind),
      l.start_date ? `from ${formatDate(l.start_date)}` : null,
      l.end_date ? `ended ${formatDate(l.end_date)}${l.end_reason ? ` (${label(PARTNERSHIP_END_REASONS, l.end_reason)?.toLowerCase()})` : ""}` : "current",
    ];
    return {
      key: l.id,
      personId: other,
      description: bits.filter(Boolean).join(" · "),
      remove: removePartnership.bind(null, familyId, personId, l.id),
      removeWhat: `the partnership with ${name(other)}`,
    };
  });
  const childRows: Kin[] = children.map((l) => ({
    key: l.id,
    personId: l.child_id,
    description: `${kindOf(l.kind)} child`,
    remove: removeParentLink.bind(null, familyId, personId, l.id),
    removeWhat: `the link to ${name(l.child_id)}`,
  }));
  const siblingRows: Kin[] = siblingRowsRaw
    .filter((r) => names.has(r.id))
    .map((r) => ({ key: r.id, personId: r.id, description: r.label }))
    .sort((a, b) => name(a.personId).localeCompare(name(b.personId)));

  // For the form: who is currently with whom.
  const currentPartners: Record<string, string[]> = {};
  for (const l of partnerships.filter((x) => !x.end_date)) {
    (currentPartners[l.person_a] ??= []).push(l.person_b);
    (currentPartners[l.person_b] ??= []).push(l.person_a);
  }
  const me = { id: personId, name: name(personId), birth_year: person.birth_year };
  const people = everyone
    .filter((p) => p.id !== personId)
    .map((p) => ({ id: p.id, name: names.get(p.id) ?? p.surname, birth_year: p.birth_year }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const group = { familyId, name, canManage: ctx.canManage };
  return (
    <>
      <Card title={`${me.name}'s family`}>
        <div className="space-y-6">
          <KinGroup title="Parents" rows={parentRows} empty="None recorded." {...group} />
          <KinGroup title="Spouse / Partner" rows={partnerRows} empty="None recorded." {...group} />
          <KinGroup title="Children" rows={childRows} empty="None recorded." {...group} />
          <KinGroup
            title="Brothers and sisters"
            rows={siblingRows}
            empty={parentIds.length ? "None recorded." : "Shown once parents are recorded."}
            note="Worked out from shared parents, so there is nothing to add here. A half-sibling shares one birth or adoptive parent; a step-sibling is linked only through a step or foster parent."
            {...group}
          />
        </div>
        <p className="mt-6 text-sm text-ink">
          Each link is recorded once and shows on both people&apos;s records: &ldquo;Parent of&rdquo; on one is &ldquo;Child of&rdquo; on the other.
        </p>
      </Card>

      {ctx.canEdit && (
        <Card title="Add a relationship">
          <RelationshipForm
            action={addLink.bind(null, familyId, personId)}
            me={me}
            people={people}
            existing={{
              parents: parentIds,
              children: children.map((l) => l.child_id),
              partners: mine.map((l) => (l.person_a === personId ? l.person_b : l.person_a)),
            }}
            currentPartners={currentPartners}
          />
        </Card>
      )}

      <LaterTab title="Roles in entities">
        Directorships, trusteeships and other roles will show here once the Organisation is built.
      </LaterTab>
    </>
  );
}

// ---------------------------------------------------------------------------

export async function FinancesTab({ ctx, familyId, personId }: Props) {
  const { data: tax } = await ctx.db!.from("tax_numbers").select("id, country, number").eq("person_id", personId);
  const canSee = ctx.canEdit || (tax ?? []).length > 0;
  return (
    <>
      <PrivateNote ctx={ctx} />
      {canSee && (
        <Card title="Tax numbers">
          {(tax ?? []).length === 0 ? (
            <p className="text-ink">None recorded.</p>
          ) : (
            <ul className="divide-y divide-border">
              {(tax ?? []).map((t: { id: string; country: string; number: string }) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span className="text-ink">
                    {t.country} · {t.number}
                  </span>
                  {ctx.canManage && <RemoveButton action={removeTaxNumber.bind(null, familyId, personId, t.id)} what={`tax number ${t.number}`} />}
                </li>
              ))}
            </ul>
          )}
          {ctx.canEdit && (
            <form action={addTaxNumber.bind(null, familyId, personId)} className="mt-4 grid gap-4 sm:grid-cols-3 sm:items-end">
              <Field label="Country" name="country" required />
              <Field label="Tax number" name="number" required />
              <SubmitButton variant="secondary">Add tax number</SubmitButton>
            </form>
          )}
        </Card>
      )}
      <LaterTab title="Distributions received">
        Distributions, showing whether each came from the income pool or the capital pool, will show here once
        Dividends and Distributions are built.
      </LaterTab>
    </>
  );
}

// ---------------------------------------------------------------------------

const TABLE_LABELS: Record<string, string> = {
  people: "Overview",
  person_details: "Personal details",
  passports: "Passport",
  tax_numbers: "Tax number",
  phone_numbers: "Telephone number",
  person_addresses: "Address",
  parent_child: "Family link",
  partnerships: "Partnership",
};

export async function HistoryTab({ ctx, personId }: Props) {
  if (!ctx.canManage) {
    return (
      <LaterTab title="History">
        Only the family&apos;s Managers can see the change history.
      </LaterTab>
    );
  }
  // Changes to this person's own record, and to rows that belong to them.
  const { data: rows } = await ctx.db!
    .from("audit_log")
    .select("id, action, table_name, created_at, detail")
    .or(
      [
        `record_id.eq.${personId}`,
        // New and removed rows store the row itself; changed rows store
        // "before" and "after". Look in all three places.
        ...["person_id", "child_id", "parent_id", "person_a", "person_b"].flatMap((col) => [
          `detail->>${col}.eq.${personId}`,
          `detail->before->>${col}.eq.${personId}`,
          `detail->after->>${col}.eq.${personId}`,
        ]),
      ].join(","),
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const verbs: Record<string, string> = { insert: "added", update: "changed", delete: "removed" };
  return (
    <Card title="History">
      {(rows ?? []).length === 0 ? (
        <p className="text-ink">No changes recorded yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {(rows ?? []).map((r: { id: number; action: string; table_name: string; created_at: string }) => (
            <li key={r.id} className="py-3 text-ink">
              {new Date(r.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" })} ·{" "}
              {TABLE_LABELS[r.table_name] ?? r.table_name} {verbs[r.action] ?? r.action}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
