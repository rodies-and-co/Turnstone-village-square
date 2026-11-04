import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageTitle } from "@/components/AppShell";
import { Card, Chip } from "@/components/ui";
import { APPOINTMENT_ROLES, ENTITY_TYPES, type AppointmentRole, type EntityType } from "@/lib/entity-checklist";
import { getFamilyContext } from "@/lib/family-context";
import { formatDate } from "@/lib/governance";
import { holderKey } from "@/lib/ownership";
import { displayNames, type PersonSummary } from "@/lib/people";
import { namer } from "../../organisation/compliance-data";
import { loadOrganisationData, type Appointment } from "../../organisation/organisation-data";

export const dynamic = "force-dynamic";

// Offices across the family's entities, two ways round: each person (or
// firm) and the offices they hold, or each entity and its officers.
export default async function OfficersReport({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string }>;
  searchParams: Promise<{ view?: string; show?: string; branch?: string }>;
}) {
  const { familyId } = await params;
  const sp = await searchParams;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db) notFound();
  const [data, { data: peopleRows }, { data: branchRows }] = await Promise.all([
    loadOrganisationData(ctx),
    ctx.db.from("people").select("id, full_names, surname, known_as, birth_year"),
    ctx.db.from("branches").select("id, name").order("name"),
  ]);
  const names = displayNames((peopleRows ?? []) as PersonSummary[]);
  const nameOf = namer(data, names);
  const view = sp.view === "entities" ? "entities" : "people";
  const all = sp.show === "all";
  const branches = (branchRows ?? []) as { id: string; name: string }[];
  const branch = branches.find((b) => b.id === sp.branch)?.id;
  const entities = data.entities.filter((e) => !branch || e.branch_id === branch).sort((a, b) => a.name.localeCompare(b.name));
  const entityIds = new Set(entities.map((e) => e.id));
  const entityName = new Map(data.entities.map((e) => [e.id, e.name]));
  const appts = data.appointments.filter((a) => entityIds.has(a.entity_id) && a.holder && (all || !a.ceased_on));
  const role = (a: Appointment) => APPOINTMENT_ROLES[a.role as AppointmentRole] ?? a.role;
  const dates = (a: Appointment) =>
    a.ceased_on ? `${a.appointed_on ? `${formatDate(a.appointed_on)} to ` : "Until "}${formatDate(a.ceased_on)}` : a.appointed_on ? `Since ${formatDate(a.appointed_on)}` : "Date not recorded";

  // By holder: one card per person, firm or entity holding office.
  const byHolder = new Map<string, { name: string; kind: string; list: Appointment[] }>();
  for (const a of appts) {
    const k = holderKey(a.holder!);
    if (!byHolder.has(k)) byHolder.set(k, { name: nameOf(a.holder!), kind: a.holder!.kind, list: [] });
    byHolder.get(k)!.list.push(a);
  }
  const holders = [...byHolder.entries()].sort((a, b) => (a[1].kind === b[1].kind ? a[1].name.localeCompare(b[1].name) : a[1].kind === "person" ? -1 : 1));
  const familyName = /family$/i.test(ctx.family.name.trim()) ? ctx.family.name : `${ctx.family.name} family`;
  const link = (p: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const v = { view, show: all ? "all" : undefined, branch, ...p };
    for (const [k, x] of Object.entries(v)) if (x) q.set(k, x);
    return `/families/${familyId}/reports/officers?${q.toString()}`;
  };
  const tab = (active: boolean) => `inline-flex min-h-11 items-center border-b-2 px-3 text-[15px] ${active ? "border-primary font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"}`;

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="officers"
      crumbs={[["My families", "/"], [familyName, `/families/${familyId}`], ["Reports", `/families/${familyId}/reports`], ["Officers & offices"]]}
      user={{ name: ctx.displayName, roleLabel: ctx.roleLabel, hasTwoFactor: ctx.hasTwoFactor }}
    >
      <PageTitle title="Officers & offices" subtitle="Who holds which office in the family's entities. Choose to see it by person or by entity." />
      <nav aria-label="View" className="mt-2 border-b border-border print:hidden">
        <ul className="flex flex-wrap gap-x-1">
          <li>
            <Link href={link({ view: "people" })} aria-current={view === "people" ? "page" : undefined} className={tab(view === "people")}>
              By person
            </Link>
          </li>
          <li>
            <Link href={link({ view: "entities" })} aria-current={view === "entities" ? "page" : undefined} className={tab(view === "entities")}>
              By entity
            </Link>
          </li>
        </ul>
      </nav>
      <form method="get" className="mt-4 flex flex-wrap items-end gap-3 print:hidden">
        <input type="hidden" name="view" value={view} />
        <div>
          <label htmlFor="o-show" className="mb-1 block text-sm font-medium text-ink">
            Offices
          </label>
          <select id="o-show" name="show" defaultValue={all ? "all" : "current"} className="text-input">
            <option value="current">Current only</option>
            <option value="all">Current and former</option>
          </select>
        </div>
        <div>
          <label htmlFor="o-branch" className="mb-1 block text-sm font-medium text-ink">
            Entities of
          </label>
          <select id="o-branch" name="branch" defaultValue={branch ?? ""} className="text-input">
            <option value="">The whole family</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-secondary">
          Show
        </button>
      </form>

      <div className="mt-6 space-y-5">
        {view === "people" ? (
          holders.length === 0 ? (
            <p className="rounded-lg border border-border bg-card px-4 py-3 text-ink-2">No offices recorded.</p>
          ) : (
            holders.map(([k, h]) => (
              <Card key={k} title={h.name} description={h.kind === "person" ? undefined : h.kind === "organisation" ? "Service provider" : "One of the family's entities"} actions={<Chip>{h.list.filter((a) => !a.ceased_on).length} current</Chip>}>
                <ul className="divide-y divide-border border-y border-border">
                  {h.list
                    .sort((a, b) => Number(Boolean(a.ceased_on)) - Number(Boolean(b.ceased_on)) || (entityName.get(a.entity_id) ?? "").localeCompare(entityName.get(b.entity_id) ?? ""))
                    .map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <span>
                          <span className="font-medium text-ink">{role(a)}</span>
                          <span className="text-ink-2"> of </span>
                          <Link href={`/families/${familyId}/organisation/${a.entity_id}?tab=officers`} className="inline-flex min-h-11 items-center text-ink underline">
                            {entityName.get(a.entity_id)}
                          </Link>
                        </span>
                        <span className="text-sm text-ink-3">
                          {dates(a)}
                          {a.ceased_on ? " · Former" : ""}
                        </span>
                      </li>
                    ))}
                </ul>
              </Card>
            ))
          )
        ) : (
          entities.map((e) => {
            const list = appts.filter((a) => a.entity_id === e.id).sort((a, b) => Number(Boolean(a.ceased_on)) - Number(Boolean(b.ceased_on)) || role(a).localeCompare(role(b)));
            return (
              <Card
                key={e.id}
                title={e.name}
                description={`${ENTITY_TYPES[e.entity_type as EntityType] ?? e.entity_type} · ${e.jurisdiction}${e.status === "dissolved" ? " · Dissolved" : ""}`}
                actions={
                  <Link href={`/families/${familyId}/organisation/${e.id}?tab=registers`} className="btn-secondary print:hidden">
                    Registers
                  </Link>
                }
              >
                {list.length === 0 ? (
                  <p className="text-ink-3">No officers recorded.</p>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-ink">
                        <th scope="col" className="py-2 pr-3 font-semibold">Office</th>
                        <th scope="col" className="py-2 pr-3 font-semibold">Held by</th>
                        <th scope="col" className="py-2 font-semibold">Dates</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((a) => (
                        <tr key={a.id} className="border-b border-border">
                          <td className="py-2 pr-3">{role(a)}</td>
                          <td className="py-2 pr-3">{nameOf(a.holder!)}</td>
                          <td className="py-2 text-ink-2">
                            {dates(a)}
                            {a.ceased_on ? " · Former" : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            );
          })
        )}
      </div>
    </AppShell>
  );
}
