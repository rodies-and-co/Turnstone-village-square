import Link from "next/link";
import type { ReactNode } from "react";
import { ConfirmRemove, SubmitButton } from "@/components/feedback";
import {
  Card,
  Facts,
  Field,
  Fold,
  Notice,
  Row,
  Rows,
  Select,
} from "@/components/ui";
import type { FamilyContext } from "@/lib/family-context";
import {
  ADDRESS_KINDS,
  MEMBER_TYPES,
  PARENT_KINDS,
  PARTNERSHIP_END_REASONS,
  PARTNERSHIP_KINDS,
  RELATIONSHIP_TO_WEALTH,
  SEX_OPTIONS,
  THREE_CIRCLE_ROLES,
  formatAddress,
  lifeLine,
  siblingKinds,
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

// The tabs of a person's record, laid out as in The Family Square: beige
// panels, rows with a quiet "Remove", and fold-outs ("▸ Add a parent") so
// each small form only shows when it is wanted.

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

function label<T extends Record<string, string>>(
  map: T,
  key: string | null | undefined,
) {
  return key && key in map ? map[key as keyof T] : null;
}

function formatDate(d: string | null | undefined) {
  if (!d) return null;
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// "Remove" on a row, for Managers only. It asks first.
function RemoveButton({
  action,
  what,
}: {
  action: () => Promise<void>;
  what: string;
}) {
  return <ConfirmRemove action={action} what={what} />;
}

function PrivateNote({ ctx }: { ctx: FamilyContext }) {
  if (ctx.canEdit) return null;
  return (
    <Notice>
      Personal details are only shown to the family&apos;s Managers and
      Administrators, and to the person themself.
    </Notice>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="border-y border-border py-3 text-ink-3">{children}</p>;
}

export function LaterTab({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Card title={title}>
      <p className="text-ink-2">{children}</p>
    </Card>
  );
}

const firstName = (p: Person) => p.known_as || p.full_names.split(/\s+/)[0];

// ---------------------------------------------------------------------------
// Overview: the details, edited in place by Managers and Administrators.

export async function OverviewTab({ ctx, familyId, personId, person }: Props) {
  const [{ data: branches }, { data: details }] = await Promise.all([
    ctx.db!.from("branches").select("id, name").order("name"),
    // The full date is private: only editors (and the person themself) get it back.
    ctx
      .db!.from("person_details")
      .select("date_of_birth")
      .eq("person_id", personId)
      .maybeSingle(),
  ]);
  const branchName = (branches ?? []).find(
    (b: { id: string }) => b.id === person.branch_id,
  )?.name;
  const dob: string | null = details?.date_of_birth ?? null;

  return (
    <>
      {ctx.canEdit ? (
        <Card title="Details">
          <form
            action={updatePerson.bind(null, familyId, personId)}
            className="space-y-6"
          >
            <PersonFields
              values={{ ...person, date_of_birth: dob }}
              branches={branches ?? []}
              canChooseBranch={ctx.canManage}
            />
            <SubmitButton>Save changes</SubmitButton>
          </form>
        </Card>
      ) : (
        <Card title="Details">
          <Facts
            items={[
              ["Full names", person.full_names],
              ["Surname", person.surname],
              ["Known as", person.known_as],
              ["Maiden name", person.maiden_name],
              ["Type of member", MEMBER_TYPES[person.member_type]],
              ["Year of birth", person.birth_year],
              [
                "Three circle role",
                label(THREE_CIRCLE_ROLES, person.three_circle_role),
              ],
              ["Branch", branchName],
              ["Deceased", person.deceased ? "Yes" : "No"],
            ]}
          />
        </Card>
      )}

      {ctx.canEdit && (
        <Card title="Remove from the Tree">
          <Fold label={`Remove ${firstName(person)} from the Tree`} danger>
            <p className="text-sm text-ink-2">
              This removes {firstName(person)} with their personal details,
              addresses, documents and family links. The change is recorded in
              the history. It is removed only once another Manager approves the
              request on the family Overview.
            </p>
            <form
              action={removePerson.bind(null, familyId, personId)}
              className="mt-3"
            >
              <SubmitButton pendingText="Asking…">
                Ask to remove {firstName(person)}
              </SubmitButton>
            </form>
          </Fold>
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Identity: birth, sex, email, wealth and passports.

export async function IdentityTab({ ctx, familyId, personId, person }: Props) {
  const db = ctx.db!;
  const [{ data: details }, { data: passports }] = await Promise.all([
    db
      .from("person_details")
      .select("*")
      .eq("person_id", personId)
      .maybeSingle(),
    db
      .from("passports")
      .select("id, country, number, expires_on")
      .eq("person_id", personId)
      .order("expires_on"),
  ]);
  const d = details ?? {};
  const canSee = ctx.canEdit || details || (passports ?? []).length > 0;
  const dobText =
    formatDate(d.date_of_birth) ??
    (person.birth_year
      ? `${person.birth_year} (day and month not known)`
      : "Not recorded");

  return (
    <>
      <PrivateNote ctx={ctx} />
      {ctx.canEdit ? (
        <Card
          title="Personal details"
          description={
            <>
              Date of birth:{" "}
              <strong className="font-medium text-ink">{dobText}</strong>. It is
              entered once, under{" "}
              <Link
                href={`/families/${familyId}/tree/${personId}?tab=overview`}
                className="underline"
              >
                Overview
              </Link>
              .
            </>
          }
        >
          <form
            action={saveDetails.bind(null, familyId, personId)}
            className="space-y-6"
          >
            <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
              <Select
                label="Sex"
                name="sex"
                options={SEX_OPTIONS}
                defaultValue={d.sex ?? "unspecified"}
              />
              <Field
                label="Town or city of birth"
                name="city_of_birth"
                defaultValue={d.city_of_birth}
              />
              <Field
                label="Country of birth"
                name="country_of_birth"
                defaultValue={d.country_of_birth}
              />
              <Field
                label="Email"
                name="email"
                type="email"
                defaultValue={d.email}
              />
              <Field
                label="Date of death"
                name="date_of_death"
                type="date"
                defaultValue={d.date_of_death}
                hint="Leave empty if living."
              />
              <Select
                label="Relationship to wealth"
                name="relationship_to_wealth"
                options={RELATIONSHIP_TO_WEALTH}
                defaultValue={d.relationship_to_wealth}
                includeBlank="Not recorded"
              />
              <Field
                label="Psychometric consent date"
                name="psychometric_consent_date"
                type="date"
                defaultValue={d.psychometric_consent_date}
              />
            </div>
            <SubmitButton>Save changes</SubmitButton>
          </form>
        </Card>
      ) : (
        details && (
          <Card title="Personal details">
            <Facts
              items={[
                ["Date of birth", dobText],
                [
                  "Place of birth",
                  [d.city_of_birth, d.country_of_birth]
                    .filter(Boolean)
                    .join(", "),
                ],
                ["Sex", label(SEX_OPTIONS, d.sex)],
                ["Email", d.email],
                ["Date of death", formatDate(d.date_of_death)],
                [
                  "Relationship to wealth",
                  label(RELATIONSHIP_TO_WEALTH, d.relationship_to_wealth),
                ],
                [
                  "Psychometric consent date",
                  formatDate(d.psychometric_consent_date),
                ],
              ]}
            />
          </Card>
        )
      )}

      {canSee && (
        <Card title="Passports">
          {(passports ?? []).length === 0 ? (
            <Empty>None recorded.</Empty>
          ) : (
            <Rows>
              {(passports ?? []).map(
                (p: {
                  id: string;
                  country: string;
                  number: string;
                  expires_on: string | null;
                }) => (
                  <Row
                    key={p.id}
                    title={`${p.country} · ${p.number}`}
                    meta={
                      p.expires_on
                        ? `Expires ${formatDate(p.expires_on)}`
                        : "Expiry not recorded"
                    }
                  >
                    {ctx.canEdit && (
                      <RemoveButton
                        action={removePassport.bind(
                          null,
                          familyId,
                          personId,
                          p.id,
                        )}
                        what={`passport ${p.number}`}
                      />
                    )}
                  </Row>
                ),
              )}
            </Rows>
          )}
          {ctx.canEdit && (
            <Fold label="Add a passport">
              <form
                action={addPassport.bind(null, familyId, personId)}
                className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
              >
                <Field label="Country" name="country" required />
                <Field label="Number" name="number" required />
                <Field label="Expires" name="expires_on" type="date" />
                <SubmitButton pendingText="Adding…">Add passport</SubmitButton>
              </form>
            </Fold>
          )}
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Addresses and contact details.

type Addr = {
  id: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postal_code: string | null;
  country: string;
};

export async function AddressesTab({ ctx, familyId, personId }: Props) {
  const db = ctx.db!;
  const [{ data: links }, { data: phones }, { data: allAddresses }] =
    await Promise.all([
      db
        .from("person_addresses")
        .select(
          "id, kind, is_current, addresses(id, line1, line2, city, region, postal_code, country)",
        )
        .eq("person_id", personId),
      db
        .from("phone_numbers")
        .select("id, label, number")
        .eq("person_id", personId)
        .order("created_at"),
      ctx.canEdit
        ? db
            .from("addresses")
            .select("id, line1, line2, city, region, postal_code, country")
            .order("city")
        : { data: [] },
    ]);
  const { data: details } = await db
    .from("person_details")
    .select("email")
    .eq("person_id", personId)
    .maybeSingle();
  const canSee =
    ctx.canEdit ||
    (links ?? []).length > 0 ||
    (phones ?? []).length > 0 ||
    details;

  return (
    <>
      <PrivateNote ctx={ctx} />
      {canSee && (
        <Card
          title="Addresses"
          description="Addresses are shared: if two people live at the same address, it is stored once."
        >
          {(links ?? []).length === 0 ? (
            <Empty>None recorded.</Empty>
          ) : (
            <Rows>
              {(links ?? []).map(
                (l: {
                  id: string;
                  kind: string;
                  addresses: Addr | Addr[] | null;
                }) => {
                  const a = Array.isArray(l.addresses)
                    ? l.addresses[0]
                    : l.addresses;
                  return (
                    <Row
                      key={l.id}
                      title={a ? formatAddress(a) : "—"}
                      meta={label(ADDRESS_KINDS, l.kind)}
                    >
                      {ctx.canEdit && (
                        <RemoveButton
                          action={removePersonAddress.bind(
                            null,
                            familyId,
                            personId,
                            l.id,
                          )}
                          what="this address"
                        />
                      )}
                    </Row>
                  );
                },
              )}
            </Rows>
          )}
          {ctx.canEdit && (
            <Fold label="Add an address">
              <form
                action={addAddress.bind(null, familyId, personId)}
                className="space-y-4"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Select
                    label="An address the family already has"
                    name="address_id"
                    options={(allAddresses ?? []).map(
                      (a: Addr) => [a.id, formatAddress(a)] as [string, string],
                    )}
                    includeBlank="None: type a new address below"
                  />
                  <Select
                    label="Used as"
                    name="kind"
                    options={ADDRESS_KINDS}
                    defaultValue="home"
                  />
                </div>
                <p className="text-sm text-ink-3">
                  Or type a new one. If it matches an address already recorded,
                  that one is used.
                </p>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="First line" name="line1" />
                  <Field label="Second line" name="line2" />
                  <Field label="Town or city" name="city" />
                  <Field label="County, state or region" name="region" />
                  <Field label="Postcode" name="postal_code" />
                  <Field label="Country" name="country" />
                </div>
                <SubmitButton pendingText="Adding…">Add address</SubmitButton>
              </form>
            </Fold>
          )}
        </Card>
      )}

      {canSee && (
        <Card
          title="Phone and email"
          description="The email address is changed under Identity."
        >
          <Rows>
            <Row title={details?.email ?? "No email recorded"} meta="Email" />
            {(phones ?? []).map(
              (p: { id: string; label: string; number: string }) => (
                <Row key={p.id} title={p.number} meta={p.label}>
                  {ctx.canEdit && (
                    <RemoveButton
                      action={removePhone.bind(null, familyId, personId, p.id)}
                      what={`phone ${p.number}`}
                    />
                  )}
                </Row>
              ),
            )}
          </Rows>
          {ctx.canEdit && (
            <Fold label="Add a phone number">
              <form
                action={addPhone.bind(null, familyId, personId)}
                className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
              >
                <Field label="Label" name="label" defaultValue="Mobile" />
                <Field label="Number" name="number" type="tel" required />
                <SubmitButton pendingText="Adding…">Add number</SubmitButton>
              </form>
            </Fold>
          )}
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Family and roles: marriages, parents and children, brothers and sisters.

type PartnerRow = {
  id: string;
  person_a: string;
  person_b: string;
  kind: string;
  start_date: string | null;
  end_date: string | null;
  end_reason: string | null;
};

export async function RelationshipsTab({
  ctx,
  familyId,
  personId,
  person,
  everyone,
  names,
}: Props) {
  const db = ctx.db!;
  const [{ data: parentLinks }, { data: childLinks }, { data: allPartners }] =
    await Promise.all([
      db
        .from("parent_child")
        .select("id, parent_id, kind")
        .eq("child_id", personId),
      db
        .from("parent_child")
        .select("id, child_id, kind")
        .eq("parent_id", personId),
      // Every partnership this user can see: needed to suggest a second parent.
      db
        .from("partnerships")
        .select(
          "id, person_a, person_b, kind, start_date, end_date, end_reason",
        )
        .order("start_date", { nullsFirst: false }),
    ]);
  const parents = (parentLinks ?? []) as {
    id: string;
    parent_id: string;
    kind: string;
  }[];
  const children = (childLinks ?? []) as {
    id: string;
    child_id: string;
    kind: string;
  }[];
  const partnerships = (allPartners ?? []) as PartnerRow[];
  const mine = partnerships.filter(
    (l) => l.person_a === personId || l.person_b === personId,
  );

  // Brothers and sisters are worked out from shared parents, never typed in.
  const parentIds = parents.map((l) => l.parent_id);
  const { data: viaParents } = parentIds.length
    ? await db
        .from("parent_child")
        .select("child_id")
        .in("parent_id", parentIds)
        .neq("child_id", personId)
    : { data: [] };
  const siblingIds = [
    ...new Set(
      ((viaParents ?? []) as { child_id: string }[]).map((l) => l.child_id),
    ),
  ];
  const { data: siblingParentLinks } = siblingIds.length
    ? await db
        .from("parent_child")
        .select("parent_id, child_id, kind")
        .in("child_id", siblingIds)
    : { data: [] };
  const siblings = siblingKinds(
    parents.map((l) => ({ parent_id: l.parent_id, kind: l.kind })),
    (siblingParentLinks ?? []) as {
      parent_id: string;
      child_id: string;
      kind: string;
    }[],
  )
    .filter((r) => names.has(r.id))
    .sort((a, b) =>
      (names.get(a.id) ?? "").localeCompare(names.get(b.id) ?? ""),
    );

  const byId = new Map(everyone.map((p) => [p.id, p]));
  const name = (id: string) => names.get(id) ?? "Someone you can't see";
  const life = (id: string) => {
    const p = byId.get(id);
    return p ? lifeLine(p) : undefined;
  };
  const personLink = (id: string) =>
    names.has(id) ? (
      <Link
        href={`/families/${familyId}/tree/${id}?tab=relationships`}
        className="hover:underline"
      >
        {name(id)}
      </Link>
    ) : (
      name(id)
    );
  const kindOf = (k: string) => label(PARENT_KINDS, k) ?? "";

  // For the forms: who is currently with whom, and who can be chosen.
  const currentPartners: Record<string, string[]> = {};
  for (const l of partnerships.filter((x) => !x.end_date)) {
    (currentPartners[l.person_a] ??= []).push(l.person_b);
    (currentPartners[l.person_b] ??= []).push(l.person_a);
  }
  const me = {
    id: personId,
    name: name(personId),
    birth_year: person.birth_year,
  };
  const people = everyone
    .filter((p) => p.id !== personId)
    .map((p) => ({
      id: p.id,
      name: names.get(p.id) ?? p.surname,
      birth_year: p.birth_year,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const existing = {
    parents: parentIds,
    children: children.map((l) => l.child_id),
    partners: mine.map((l) =>
      l.person_a === personId ? l.person_b : l.person_a,
    ),
  };
  const form = (fixed: "parent_of" | "child_of" | "partner_of") => (
    <RelationshipForm
      action={addLink.bind(null, familyId, personId)}
      me={me}
      people={people}
      existing={existing}
      currentPartners={currentPartners}
      fixed={fixed}
    />
  );

  return (
    <>
      <Card title="Marriages and partnerships">
        {mine.length === 0 ? (
          <Empty>None recorded.</Empty>
        ) : (
          <Rows>
            {mine.map((l) => {
              const other = l.person_a === personId ? l.person_b : l.person_a;
              const verb =
                l.kind === "marriage"
                  ? "Married to"
                  : l.kind === "civil_partnership"
                    ? "Civil partner of"
                    : "Partner of";
              const when = [
                l.start_date ? `Since ${formatDate(l.start_date)}` : null,
                l.end_date
                  ? `Ended ${formatDate(l.end_date)}${l.end_reason ? ` (${label(PARTNERSHIP_END_REASONS, l.end_reason)?.toLowerCase()})` : ""}`
                  : "Current",
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <Row
                  key={l.id}
                  title={
                    <>
                      {verb} {personLink(other)}
                    </>
                  }
                  meta={`${label(PARTNERSHIP_KINDS, l.kind)} · ${when}`}
                >
                  {ctx.canEdit && (
                    <RemoveButton
                      action={removePartnership.bind(
                        null,
                        familyId,
                        personId,
                        l.id,
                      )}
                      what={`the partnership with ${name(other)}`}
                    />
                  )}
                </Row>
              );
            })}
          </Rows>
        )}
        {ctx.canEdit && (
          <Fold label="Add a marriage or partnership">
            {form("partner_of")}
          </Fold>
        )}
      </Card>

      <Card
        title="Parents and children"
        description="Each link shows on both people's records."
      >
        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-[15px] font-semibold text-ink">Parents</h3>
            {parents.length === 0 ? (
              <Empty>None recorded.</Empty>
            ) : (
              <Rows>
                {parents.map((l) => (
                  <Row
                    key={l.id}
                    title={personLink(l.parent_id)}
                    meta={[`${kindOf(l.kind)} parent`, life(l.parent_id)]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    {ctx.canEdit && (
                      <RemoveButton
                        action={removeParentLink.bind(
                          null,
                          familyId,
                          personId,
                          l.id,
                        )}
                        what={`the link to ${name(l.parent_id)}`}
                      />
                    )}
                  </Row>
                ))}
              </Rows>
            )}
            {ctx.canEdit && (
              <Fold label="Add a parent">{form("child_of")}</Fold>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-[15px] font-semibold text-ink">
              Children
            </h3>
            {children.length === 0 ? (
              <Empty>None recorded.</Empty>
            ) : (
              <Rows>
                {children.map((l) => (
                  <Row
                    key={l.id}
                    title={personLink(l.child_id)}
                    meta={[`${kindOf(l.kind)} child`, life(l.child_id)]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    {ctx.canEdit && (
                      <RemoveButton
                        action={removeParentLink.bind(
                          null,
                          familyId,
                          personId,
                          l.id,
                        )}
                        what={`the link to ${name(l.child_id)}`}
                      />
                    )}
                  </Row>
                ))}
              </Rows>
            )}
            {ctx.canEdit && (
              <Fold label="Add a child">{form("parent_of")}</Fold>
            )}
          </div>
        </div>
      </Card>

      <Card
        title="Brothers and sisters"
        description="Worked out from shared parents, so there is nothing to add here. A half-sibling shares one birth or adoptive parent; a step-sibling is linked only through a step or foster parent."
      >
        {siblings.length === 0 ? (
          <Empty>
            {parentIds.length
              ? "None recorded."
              : "Shown once parents are recorded."}
          </Empty>
        ) : (
          <Rows>
            {siblings.map((s) => (
              <Row
                key={s.id}
                title={personLink(s.id)}
                meta={[s.label, life(s.id)].filter(Boolean).join(" · ")}
              />
            ))}
          </Rows>
        )}
      </Card>

      <LaterTab title="Roles in the family entities">
        Directorships, trusteeships and other roles will show here once the
        Organisation is built.
      </LaterTab>
    </>
  );
}

// ---------------------------------------------------------------------------
// Finances.

export async function FinancesTab({ ctx, familyId, personId }: Props) {
  const { data: taxNumbers } = await ctx
    .db!.from("tax_numbers")
    .select("id, country, number")
    .eq("person_id", personId)
    .order("country");
  const canSee = ctx.canEdit || (taxNumbers ?? []).length > 0;

  return (
    <>
      <PrivateNote ctx={ctx} />
      {canSee && (
        <Card title="Tax numbers">
          {(taxNumbers ?? []).length === 0 ? (
            <Empty>None recorded.</Empty>
          ) : (
            <Rows>
              {(taxNumbers ?? []).map(
                (t: { id: string; country: string; number: string }) => (
                  <Row key={t.id} title={t.number} meta={t.country}>
                    {ctx.canEdit && (
                      <RemoveButton
                        action={removeTaxNumber.bind(
                          null,
                          familyId,
                          personId,
                          t.id,
                        )}
                        what={`tax number ${t.number}`}
                      />
                    )}
                  </Row>
                ),
              )}
            </Rows>
          )}
          {ctx.canEdit && (
            <Fold label="Add a tax number">
              <form
                action={addTaxNumber.bind(null, familyId, personId)}
                className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
              >
                <Field label="Country" name="country" required />
                <Field label="Tax number" name="number" required />
                <SubmitButton pendingText="Adding…">
                  Add tax number
                </SubmitButton>
              </form>
            </Fold>
          )}
        </Card>
      )}
      <LaterTab title="Distributions received">
        Distributions, showing whether each came from the income pool or the
        capital pool, will show here once Dividends and Distributions are built.
      </LaterTab>
    </>
  );
}

// ---------------------------------------------------------------------------
// History: what changed and when (Managers only).

const TABLE_LABELS: Record<string, string> = {
  people: "Details",
  person_details: "Personal details",
  passports: "Passport",
  tax_numbers: "Tax number",
  phone_numbers: "Phone number",
  person_addresses: "Address",
  parent_child: "Family link",
  partnerships: "Marriage or partnership",
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
  const { data: rows } = await ctx
    .db!.from("audit_log")
    .select("id, action, table_name, created_at, detail")
    .or(
      [
        `record_id.eq.${personId}`,
        // New and removed rows store the row itself; changed rows store
        // "before" and "after". Look in all three places.
        ...[
          "person_id",
          "child_id",
          "parent_id",
          "person_a",
          "person_b",
        ].flatMap((col) => [
          `detail->>${col}.eq.${personId}`,
          `detail->before->>${col}.eq.${personId}`,
          `detail->after->>${col}.eq.${personId}`,
        ]),
      ].join(","),
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const verbs: Record<string, string> = {
    insert: "added",
    update: "changed",
    delete: "removed",
  };
  return (
    <Card
      title="History"
      description="Every change is recorded and can't be altered."
    >
      {(rows ?? []).length === 0 ? (
        <Empty>No changes recorded yet.</Empty>
      ) : (
        <Rows>
          {(rows ?? []).map(
            (r: {
              id: number;
              action: string;
              table_name: string;
              created_at: string;
            }) => (
              <Row
                key={r.id}
                title={`${TABLE_LABELS[r.table_name] ?? r.table_name} ${verbs[r.action] ?? r.action}`}
                meta={new Date(r.created_at).toLocaleString("en-GB", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "Europe/London",
                })}
              />
            ),
          )}
        </Rows>
      )}
    </Card>
  );
}
