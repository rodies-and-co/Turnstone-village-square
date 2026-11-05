import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageTitle } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { APPOINTMENT_ROLES, type AppointmentRole } from "@/lib/entity-checklist";
import { getFamilyContext } from "@/lib/family-context";
import { PROFESSIONS, formatDate } from "@/lib/governance";

export const dynamic = "force-dynamic";

type Advisor = { id: string; full_name: string; firm: string | null; profession: keyof typeof PROFESSIONS; email: string | null; phone: string | null };
type Role = { id: string; advisor_id: string; branch_id: string | null; advises_on: string; from_date: string | null; to_date: string | null };

// Circles of advisors (decision 2.4): the family's circle, each branch's
// circle, and the firms that serve the family's entities, in one directory.
// Advisors are added and changed under Branches → Advisors.
export default async function AdvisorsDirectory({ params, searchParams }: { params: Promise<{ familyId: string }>; searchParams: Promise<{ show?: string }> }) {
  const { familyId } = await params;
  const sp = await searchParams;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db) notFound();
  const [{ data: a }, { data: r }, { data: b }, { data: orgs }, { data: appts }, { data: ents }] = await Promise.all([
    ctx.db.from("advisors").select("id, full_name, firm, profession, email, phone").order("full_name"),
    ctx.db.from("advisor_roles").select("id, advisor_id, branch_id, advises_on, from_date, to_date"),
    ctx.db.from("branches").select("id, name").order("name"),
    ctx.db.from("outside_organisations").select("id, name, kind, jurisdiction").order("name"),
    ctx.db.from("appointments").select("entity_id, role, organisation_id, ceased_on").not("organisation_id", "is", null),
    ctx.db.from("entities").select("id, name"),
  ]);
  const advisors = (a ?? []) as Advisor[];
  const all = sp.show === "all";
  const roles = ((r ?? []) as Role[]).filter((x) => all || !x.to_date);
  const branches = (b ?? []) as { id: string; name: string }[];
  const entityName = new Map(((ents ?? []) as { id: string; name: string }[]).map((e) => [e.id, e.name]));
  const byId = new Map(advisors.map((x) => [x.id, x]));
  const circles: [string, string | null][] = [["The family's circle", null], ...branches.map((x) => [`${x.name}'s circle`, x.id] as [string, string])];
  const firms = ((orgs ?? []) as { id: string; name: string; kind: string; jurisdiction: string | null }[])
    .map((o) => ({ ...o, serves: ((appts ?? []) as { entity_id: string; role: string; organisation_id: string; ceased_on: string | null }[]).filter((x) => x.organisation_id === o.id && (all || !x.ceased_on)) }))
    .filter((o) => o.serves.length);
  const unplaced = advisors.filter((x) => !roles.some((y) => y.advisor_id === x.id));
  const familyName = /family$/i.test(ctx.family.name.trim()) ? ctx.family.name : `${ctx.family.name} family`;
  const contact = (x: Advisor) => [x.email, x.phone].filter(Boolean).join(" · ");

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="advisors"
      crumbs={[["My families", "/"], [familyName, `/families/${familyId}`], ["Circles of advisors"]]}
      user={{ name: ctx.displayName, roleLabel: ctx.roleLabel, hasTwoFactor: ctx.hasTwoFactor }}
    >
      <PageTitle
        title="Circles of advisors"
        subtitle="The people and firms who advise and serve the family."
        actions={
          ctx.canEdit ? (
            <Link href={`/families/${familyId}/branches/advisors`} className="btn-secondary">
              Add or change advisors
            </Link>
          ) : undefined
        }
      />
      <p className="mb-4 flex flex-wrap gap-4">
        <Link href={`/families/${familyId}/village/advisors`} aria-current={!all ? "page" : undefined} className={`inline-flex min-h-11 items-center ${!all ? "font-semibold text-ink" : "text-ink-2 underline"}`}>
          Current
        </Link>
        <Link href={`/families/${familyId}/village/advisors?show=all`} aria-current={all ? "page" : undefined} className={`inline-flex min-h-11 items-center ${all ? "font-semibold text-ink" : "text-ink-2 underline"}`}>
          Current and former
        </Link>
      </p>
      <div className="space-y-5">
        {circles.map(([title, branchId]) => {
          const list = roles.filter((x) => x.branch_id === branchId);
          if (branchId && list.length === 0) return null;
          return (
            <Card key={title} title={title}>
              {list.length === 0 ? (
                <p className="text-ink-3">No advisors in this circle yet.</p>
              ) : (
                <ul className="divide-y divide-border border-y border-border">
                  {list
                    .sort((x, y) => (byId.get(x.advisor_id)?.full_name ?? "").localeCompare(byId.get(y.advisor_id)?.full_name ?? ""))
                    .map((x) => {
                      const adv = byId.get(x.advisor_id);
                      if (!adv) return null;
                      return (
                        <li key={x.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                          <div>
                            <p className="font-medium text-ink">
                              {adv.full_name}
                              <span className="font-normal text-ink-2"> · {PROFESSIONS[adv.profession] ?? adv.profession}{adv.firm ? `, ${adv.firm}` : ""}</span>
                            </p>
                            <p className="text-sm text-ink-2">Advises on: {x.advises_on}</p>
                            {contact(adv) && <p className="text-sm text-ink-3">{contact(adv)}</p>}
                          </div>
                          <p className="text-sm text-ink-3">
                            {x.to_date ? `Until ${formatDate(x.to_date)}` : x.from_date ? `Since ${formatDate(x.from_date)}` : "Current"}
                          </p>
                        </li>
                      );
                    })}
                </ul>
              )}
            </Card>
          );
        })}
        {unplaced.length > 0 && ctx.canEdit && (
          <Card title="Not in a circle yet" description="Recorded as advisors, but not placed in the family's or a branch's circle.">
            <ul className="divide-y divide-border border-y border-border">
              {unplaced.map((x) => (
                <li key={x.id} className="py-2 text-ink">
                  {x.full_name} <span className="text-ink-2">· {PROFESSIONS[x.profession] ?? x.profession}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Card title="Firms serving the family's entities" description="Service providers such as registered agents, trust companies and auditors, and the entities they serve.">
          {firms.length === 0 ? (
            <p className="text-ink-3">None recorded.</p>
          ) : (
            <ul className="divide-y divide-border border-y border-border">
              {firms.map((o) => (
                <li key={o.id} className="py-3">
                  <p className="font-medium text-ink">
                    {o.name}
                    {o.jurisdiction ? <span className="font-normal text-ink-2"> · {o.jurisdiction}</span> : null}
                  </p>
                  <ul className="mt-1 text-sm text-ink-2">
                    {o.serves.map((x, i) => (
                      <li key={i}>
                        {APPOINTMENT_ROLES[x.role as AppointmentRole] ?? x.role} of{" "}
                        <Link href={`/families/${familyId}/organisation/${x.entity_id}?tab=officers`} className="inline-flex min-h-11 items-center underline">
                          {entityName.get(x.entity_id) ?? "an entity"}
                        </Link>
                        {x.ceased_on ? ` (until ${formatDate(x.ceased_on)})` : ""}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
