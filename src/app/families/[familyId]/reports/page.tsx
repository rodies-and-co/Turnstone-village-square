import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageTitle } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { ENTITY_TYPES, type EntityType } from "@/lib/entity-checklist";
import { getFamilyContext } from "@/lib/family-context";

export const dynamic = "force-dynamic";

// Reports for the family and its branches, in one place. Individual reports
// stay on each person's and entity's own page.
export default async function ReportsPage({ params }: { params: Promise<{ familyId: string }> }) {
  const { familyId } = await params;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db) notFound();
  const { data } = await ctx.db.from("entities").select("id, name, entity_type, jurisdiction, status").order("name");
  const entities = (data ?? []) as { id: string; name: string; entity_type: string; jurisdiction: string; status: string }[];
  const f = `/families/${familyId}`;
  const familyName = /family$/i.test(ctx.family.name.trim()) ? ctx.family.name : `${ctx.family.name} family`;
  const tile = (href: string, title: string, text: string) => (
    <li>
      <Link href={href} className="block min-h-11 rounded-lg border border-border bg-white px-4 py-3 hover:bg-muted">
        <span className="block text-[15px] font-semibold text-ink">{title}</span>
        <span className="block text-sm text-ink-2">{text}</span>
      </Link>
    </li>
  );

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="reports"
      crumbs={[["My families", "/"], [familyName, `/families/${familyId}`], ["Reports"]]}
      user={{ name: ctx.displayName, roleLabel: ctx.roleLabel, hasTwoFactor: ctx.hasTwoFactor }}
    >
      <PageTitle title="Reports" subtitle="Reports for the family and its branches. Each can be printed or saved as a PDF from the browser." />
      <div className="mt-6 space-y-5">
        <Card title="For the family">
          <ul className="grid gap-3 sm:grid-cols-2">
            {tile(`${f}/reports/timeline`, "Family timeline", "Life events, entities and ownership, governance and other turning points.")}
            {tile(`${f}/reports/officers`, "Officers & offices", "Who holds which office, by person or by entity.")}
            {tile(`${f}/organisation/structure`, "Structure chart", "How the family's entities own and control each other.")}
            {tile(`${f}/risks?view=heatmap`, "Risk heat map", "The family's risks, before and after controls.")}
            {tile(`${f}/reports/me`, "My records", "What the records hold about you: offices, shares, benefits and payments.")}
          </ul>
        </Card>
        <Card title="Registers of each entity" description="The statutory registers: members, directors and officers, beneficial owners, settlors or founders, and beneficiaries.">
          {entities.length === 0 ? (
            <p className="text-ink-3">No entities you can see.</p>
          ) : (
            <ul className="divide-y divide-border border-y border-border">
              {entities.map((e) => (
                <li key={e.id}>
                  <Link href={`${f}/organisation/${e.id}?tab=registers`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2 hover:underline">
                    <span className="font-medium text-ink">{e.name}</span>
                    <span className="text-sm text-ink-3">
                      {ENTITY_TYPES[e.entity_type as EntityType] ?? e.entity_type} · {e.jurisdiction}
                      {e.status === "dissolved" ? " · Dissolved" : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
