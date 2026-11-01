import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageTitle } from "@/components/AppShell";
import { ConfirmRemove, SubmitButton, Toast } from "@/components/feedback";
import { Card, Chip, Facts, Field, Fold, Notice, Row, Rows, Select, UnderlineTabs } from "@/components/ui";
import { APPOINTMENT_ROLES, ENTITY_TYPES, ROLES_FOR, matchStandard, setupChecklist, type AppointmentRole, type EntityType } from "@/lib/entity-checklist";
import { getFamilyContext } from "@/lib/family-context";
import { formatDate } from "@/lib/governance";
import { errorMessage, savedMessage } from "@/lib/messages";
import { displayNames, formatAddress, type PersonSummary } from "@/lib/people";
import { MONTHS_SHORT, STATUS_LABELS, boRuleText, type EntityStandard } from "@/lib/standards";
import { EntityFields } from "../EntityFields";
import { endAppointment, removeAppointment, removeEntity, setRegisteredOffice, updateEntity, addAppointment } from "../actions";
import { AppointmentForm } from "./AppointmentForm";
import { OwnershipTab } from "./OwnershipTab";

export const dynamic = "force-dynamic";

const TABS = [
  ["overview", "Overview"],
  ["officers", "Officers & appointments"],
  ["ownership", "Ownership & control"],
  ["registers", "Registers"],
  ["compliance", "Compliance & filings"],
  ["decisions", "Decisions & file notes"],
  ["todo", "To do"],
  ["risks", "Risks"],
  ["organogram", "Organogram"],
  ["finances", "Finances"],
  ["documents", "Documents"],
  ["history", "History"],
] as const;
type Tab = (typeof TABS)[number][0];

const LATER: Partial<Record<Tab, string>> = {
  registers: "The statutory registers (members, officers, beneficial owners) are gathered here in the Compliance step. The register of members is on the Ownership & control tab.",
  compliance: "The filings calendar, worked out from the Entity Standard, comes in the Compliance step.",
  decisions: "Minutes, written resolutions and file notes come with Meetings, resolutions and notes.",
  todo: "This entity's items from the family's one to-do list come with Organising.",
  risks: "This entity's view of the family's one risk register comes with Risk Management.",
  organogram: "The structure chart, drawn from the ownership recorded, comes in the Compliance step.",
  finances: "Assets, liabilities, and the income and capital pools come with Finances.",
  documents: "This entity's documents come with the Vault.",
};

type Entity = {
  id: string;
  name: string;
  entity_type: EntityType;
  jurisdiction: string;
  sub_type: string;
  standard_id: string | null;
  registration_number: string | null;
  registered_on: string | null;
  registered_address_id: string | null;
  activity: string | null;
  year_end_month: number | null;
  year_end_day: number | null;
  base_currency: string | null;
  family_contact_id: string | null;
  branch_id: string | null;
  status: string;
  dissolved_on: string | null;
};
type Appointment = {
  id: string;
  role: AppointmentRole;
  person_id: string | null;
  organisation_id: string | null;
  resident: boolean;
  identity_verified: boolean;
  licensed: boolean;
  appointed_on: string | null;
  ceased_on: string | null;
};
type Addr = { id: string; line1: string; line2: string | null; city: string; region: string | null; postal_code: string | null; country: string };

export default async function EntityPage({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string; entityId: string }>;
  searchParams: Promise<{ tab?: string; saved?: string; error?: string }>;
}) {
  const { familyId, entityId } = await params;
  const sp = await searchParams;
  const tab: Tab = (TABS.find(([t]) => t === sp.tab)?.[0] ?? "overview") as Tab;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db) notFound();
  const db = ctx.db;

  const { data: entityRow } = await db.from("entities").select("*").eq("id", entityId).maybeSingle();
  if (!entityRow) notFound();
  const entity = entityRow as Entity;

  const [{ data: standardRow }, { data: apptRows }, { data: peopleRows }, { data: orgRows }, { data: branchRows }, { data: addressRows }] = await Promise.all([
    // The rules that apply now: the current version of its standard (an
    // approved newer version replaces the one it was set up under).
    ctx.supabase
      .from("entity_standards")
      .select("*")
      .then(({ data }) => ({ data: matchStandard((data ?? []) as EntityStandard[], entity) })),
    db.from("appointments").select("id, role, person_id, organisation_id, resident, identity_verified, licensed, appointed_on, ceased_on").eq("entity_id", entityId),
    db.from("people").select("id, full_names, surname, known_as, birth_year, member_type").order("surname"),
    db.from("outside_organisations").select("id, name, kind").order("name"),
    db.from("branches").select("id, name").order("name"),
    ctx.canEdit ? db.from("addresses").select("id, line1, line2, city, region, postal_code, country").order("city") : Promise.resolve({ data: [] }),
  ]);
  const standard = (standardRow ?? null) as EntityStandard | null;
  const appts = (apptRows ?? []) as Appointment[];
  const current = appts.filter((a) => !a.ceased_on);
  const past = appts.filter((a) => a.ceased_on);
  const names = displayNames((peopleRows ?? []) as PersonSummary[]);
  const orgs = new Map(((orgRows ?? []) as { id: string; name: string }[]).map((o) => [o.id, o.name]));
  const branches = (branchRows ?? []) as { id: string; name: string }[];
  const addresses = (addressRows ?? []) as Addr[];
  const office = entity.registered_address_id ? addresses.find((a) => a.id === entity.registered_address_id) : undefined;

  const holder = (a: Appointment) =>
    a.person_id ? (
      names.has(a.person_id) ? (
        <Link href={`/families/${familyId}/tree/${a.person_id}`} className="hover:underline">
          {names.get(a.person_id)}
        </Link>
      ) : (
        "Someone you can't see"
      )
    ) : (
      orgs.get(a.organisation_id ?? "") ?? "An organisation"
    );
  const holderText = (a: Appointment) => (a.person_id ? (names.get(a.person_id) ?? "this person") : (orgs.get(a.organisation_id ?? "") ?? "this organisation"));

  const familyName = /family$/i.test(ctx.family.name.trim()) ? ctx.family.name : `${ctx.family.name} family`;
  const checklist = setupChecklist(entity, current, standard);
  const open = checklist.filter((c) => !c.ok).length;
  const roleOrder = Object.keys(APPOINTMENT_ROLES);
  const sortedCurrent = [...current].sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role));
  const yearEnd = entity.year_end_month ? `${entity.year_end_day} ${MONTHS_SHORT[entity.year_end_month - 1]}` : null;

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="organisation"
      crumbs={[["My families", "/"], [familyName, `/families/${familyId}`], ["The Organisation", `/families/${familyId}/organisation`], [entity.name]]}
      user={{ name: ctx.displayName, roleLabel: ctx.roleLabel, hasTwoFactor: ctx.hasTwoFactor }}
    >
      {sp.error && <Toast key={`e-${sp.error}-${Date.now()}`} kind="error" message={errorMessage(sp.error)!} />}
      {sp.saved && !sp.error && <Toast key={`s-${sp.saved}-${Date.now()}`} message={savedMessage(sp.saved)!} />}
      <PageTitle
        eyebrow={ENTITY_TYPES[entity.entity_type]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {entity.name}
            {entity.status !== "active" && <Chip>{entity.status === "dormant" ? "Dormant" : "Dissolved"}</Chip>}
          </span>
        }
        subtitle={
          <>
            {entity.jurisdiction} · {entity.sub_type}
            <span className="block text-sm text-ink-3">
              {[entity.registration_number ? `No. ${entity.registration_number}` : null, yearEnd ? `Year end ${yearEnd}` : null, entity.base_currency]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </>
        }
        actions={
          <Link href={`/families/${familyId}/organisation`} className="btn-quiet">
            Back to the Organisation
          </Link>
        }
      />

      <UnderlineTabs
        label="Entity sections"
        current={tab}
        items={TABS.map(([t, text]) => [t, text, `/families/${familyId}/organisation/${entityId}?tab=${t}`] as [string, string, string])}
      />

      <div className="mt-6 space-y-5">
        {sp.error && <p className="alert">Not saved: {errorMessage(sp.error)}</p>}
        {standard?.status === "draft" && (
          <p className="rounded-lg border-l-4 border-primary bg-card px-4 py-3 text-ink">
            <strong className="font-semibold">Entity Standard in draft.</strong> The rules for {standard.name} haven&apos;t been approved yet, so the checklist may
            change. The Super User or System Admin reviews it.
          </p>
        )}

        {tab === "overview" && (
          <>
            <Card
              title="Setup checklist"
              description={
                standard
                  ? `What ${standard.name} requires, against what is recorded.`
                  : "No Entity Standard matches this entity, so only the general minimums are checked."
              }
            >
              <p className="mb-3 text-sm font-medium text-ink">{open === 0 ? "Everything required is recorded." : `${open} ${open === 1 ? "item needs" : "items need"} attention.`}</p>
              <Rows>
                {checklist.map((c) => (
                  <li key={c.label} className="flex items-start gap-3 py-3">
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${c.ok ? "bg-ink text-white" : "bg-primary text-ink"}`}
                    >
                      {c.ok ? "✓" : "!"}
                    </span>
                    <span>
                      <span className="block text-[15px] font-medium text-ink">
                        {c.label} <span className="sr-only">{c.ok ? "(done)" : "(needs attention)"}</span>
                      </span>
                      <span className="block text-sm text-ink-3">{c.detail}</span>
                    </span>
                  </li>
                ))}
              </Rows>
            </Card>

            <Card title="Registered office">
              {office ? <p className="text-ink">{formatAddress(office)}</p> : <p className="text-ink-3">{ctx.canEdit ? "Not recorded yet." : "Not recorded, or not visible to you."}</p>}
              {ctx.canEdit && (
                <Fold label={office ? "Change the registered office" : "Record the registered office"}>
                  <form action={setRegisteredOffice.bind(null, familyId, entityId)} className="space-y-4">
                    <Select
                      label="An address the family already has"
                      name="address_id"
                      options={addresses.map((a) => [a.id, formatAddress(a)] as [string, string])}
                      includeBlank="None: type a new address below"
                    />
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <Field label="First line" name="line1" />
                      <Field label="Second line" name="line2" />
                      <Field label="Town or city" name="city" />
                      <Field label="County, state or region" name="region" />
                      <Field label="Postcode" name="postal_code" />
                      <Field label="Country" name="country" defaultValue={entity.jurisdiction} />
                    </div>
                    <SubmitButton>Save the registered office</SubmitButton>
                  </form>
                </Fold>
              )}
            </Card>

            {ctx.canEdit ? (
              <Card title="Details">
                <form action={updateEntity.bind(null, familyId, entityId)} className="space-y-6">
                  <EntityFields
                    values={entity}
                    lockKind
                    standards={[{ jurisdiction: entity.jurisdiction, entity_type: entity.entity_type, sub_type: entity.sub_type, status: standard?.status ?? "draft" }]}
                    people={((peopleRows ?? []) as { id: string }[]).map((p) => [p.id, names.get(p.id) ?? ""] as [string, string]).sort((a, b) => a[1].localeCompare(b[1]))}
                    branches={branches.map((b) => [b.id, b.name] as [string, string])}
                  />
                  <SubmitButton>Save changes</SubmitButton>
                </form>
              </Card>
            ) : (
              <Card title="Details">
                <Facts
                  items={[
                    ["Registration number", entity.registration_number],
                    ["Registered or established", formatDate(entity.registered_on)],
                    ["Financial year end", yearEnd],
                    ["Base currency", entity.base_currency],
                    ["Activity", entity.activity],
                    ["Family contact", entity.family_contact_id ? names.get(entity.family_contact_id) : null],
                    ["Belongs to", entity.branch_id ? branches.find((b) => b.id === entity.branch_id)?.name : "The whole family"],
                  ]}
                />
              </Card>
            )}

            <Card
              title="Entity Standard"
              actions={
                standard && (
                  <Link href={`/standards/${standard.id}`} className="btn-secondary">
                    View the standard
                  </Link>
                )
              }
            >
              {standard ? (
                <Facts
                  items={[
                    ["Standard", standard.name],
                    ["Status", standard.status === "approved" ? `Approved, in force from ${formatDate(standard.effective_from)}` : STATUS_LABELS[standard.status]],
                    ["Law", standard.statute],
                    ["Beneficial ownership", boRuleText(standard)],
                    ["BO changes reported", standard.bo_change_deadline],
                    ["Registry notices", standard.registry_notice],
                  ]}
                />
              ) : (
                <p className="text-ink-2">No Entity Standard matches this entity.</p>
              )}
            </Card>

            {ctx.canManage && (
              <Card title="Remove this entity">
                <Fold label={`Remove ${entity.name}`} danger>
                  <p className="text-sm text-ink-2">This removes the entity and its appointments. The change is recorded in the history.</p>
                  <form action={removeEntity.bind(null, familyId, entityId)} className="mt-3">
                    <SubmitButton pendingText="Removing…">Yes, remove {entity.name}</SubmitButton>
                  </form>
                </Fold>
              </Card>
            )}
          </>
        )}

        {tab === "officers" && (
          <>
            <Card title="Current officers" description={standard?.officers_notes ?? undefined}>
              {sortedCurrent.length === 0 ? (
                <p className="border-y border-border py-3 text-ink-3">None recorded yet.</p>
              ) : (
                <Rows>
                  {sortedCurrent.map((a) => (
                    <Row
                      key={a.id}
                      title={holder(a)}
                      meta={[
                        APPOINTMENT_ROLES[a.role],
                        a.appointed_on ? `Since ${formatDate(a.appointed_on)}` : null,
                        a.resident ? `Resident in ${entity.jurisdiction}` : null,
                        a.identity_verified ? "Identity verified" : null,
                        a.licensed ? "Licensed" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    >
                      {ctx.canEdit && <ConfirmRemove action={endAppointment.bind(null, familyId, entityId, a.id)} what={`${holderText(a)} as ${APPOINTMENT_ROLES[a.role].toLowerCase()}`} label="End" />}
                    </Row>
                  ))}
                </Rows>
              )}
              {ctx.canEdit && (
                <Fold label="Appoint an officer">
                  <AppointmentForm
                    action={addAppointment.bind(null, familyId, entityId)}
                    roles={ROLES_FOR[entity.entity_type]}
                    people={((peopleRows ?? []) as { id: string }[]).map((p) => [p.id, names.get(p.id) ?? ""] as [string, string]).sort((a, b) => a[1].localeCompare(b[1]))}
                    organisations={[...orgs.entries()]}
                    jurisdiction={entity.jurisdiction}
                  />
                </Fold>
              )}
            </Card>
            {past.length > 0 && (
              <Card title="Past appointments">
                <Rows>
                  {past.map((a) => (
                    <Row
                      key={a.id}
                      title={holder(a)}
                      meta={[APPOINTMENT_ROLES[a.role], [formatDate(a.appointed_on), formatDate(a.ceased_on)].filter(Boolean).join(" to ")].join(" · ")}
                    >
                      {ctx.canManage && <ConfirmRemove action={removeAppointment.bind(null, familyId, entityId, a.id)} what={`this past appointment of ${holderText(a)}`} />}
                    </Row>
                  ))}
                </Rows>
              </Card>
            )}
          </>
        )}

        {tab === "ownership" && <OwnershipTab ctx={ctx} familyId={familyId} entity={entity} names={names} rule={standard} />}

        {tab === "history" && <HistoryCard ctx={ctx} entityId={entityId} />}

        {LATER[tab] && (
          <Card title={TABS.find(([t]) => t === tab)![1]}>
            <p className="text-ink-2">{LATER[tab]}</p>
          </Card>
        )}

        {!ctx.canEdit && tab === "officers" && <Notice>Only Managers and Administrators can change the officers.</Notice>}
      </div>
    </AppShell>
  );
}

const TABLE_LABELS: Record<string, string> = {
  entities: "Details",
  appointments: "Appointment",
  share_classes: "Share class",
  share_transactions: "Share transaction",
  settlements: "Settlement",
  beneficiaries: "Beneficiary",
  beneficiary_classes: "Class of beneficiaries",
  beneficiary_class_members: "Class member",
};

async function HistoryCard({ ctx, entityId }: { ctx: Awaited<ReturnType<typeof getFamilyContext>>; entityId: string }) {
  if (!ctx.canManage) {
    return (
      <Card title="History">
        <p className="text-ink-2">Only the family&apos;s Managers can see the change history.</p>
      </Card>
    );
  }
  const { data: rows } = await ctx
    .db!.from("audit_log")
    .select("id, action, table_name, created_at")
    .or([`record_id.eq.${entityId}`, `detail->>entity_id.eq.${entityId}`, `detail->before->>entity_id.eq.${entityId}`, `detail->after->>entity_id.eq.${entityId}`].join(","))
    .order("created_at", { ascending: false })
    .limit(100);
  const verbs: Record<string, string> = { insert: "added", update: "changed", delete: "removed" };
  return (
    <Card title="History" description="Every change is recorded and can't be altered.">
      {(rows ?? []).length === 0 ? (
        <p className="border-y border-border py-3 text-ink-3">No changes recorded yet.</p>
      ) : (
        <Rows>
          {(rows ?? []).map((r: { id: number; action: string; table_name: string; created_at: string }) => (
            <Row
              key={r.id}
              title={`${TABLE_LABELS[r.table_name] ?? r.table_name} ${verbs[r.action] ?? r.action}`}
              meta={new Date(r.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" })}
            />
          ))}
        </Rows>
      )}
    </Card>
  );
}
