import Link from "next/link";
import { AppShell, PageTitle } from "@/components/AppShell";
import { PrintButton } from "@/components/PrintButton";
import { Card, Notice } from "@/components/ui";
import { getFamilyContext } from "@/lib/family-context";
import { displayNames, type PersonSummary } from "@/lib/people";
import { StructureChart, chartFromData } from "../StructureChart";
import { namer } from "../compliance-data";
import { loadOrganisationData } from "../organisation-data";

export const dynamic = "force-dynamic";

// The family's structure chart: every entity, and who owns it.
export default async function StructurePage({ params }: { params: Promise<{ familyId: string }> }) {
  const { familyId } = await params;
  const ctx = await getFamilyContext(familyId);
  const familyName = /family$/i.test(ctx.family.name.trim()) ? ctx.family.name : `${ctx.family.name} family`;

  let content = <Notice>This family&apos;s database isn&apos;t connected yet.</Notice>;
  if (ctx.db) {
    const data = await loadOrganisationData(ctx);
    const { data: people } = await ctx.db.from("people").select("id, full_names, surname, known_as, birth_year");
    const names = displayNames((people ?? []) as PersonSummary[]);
    const { nodes, edges } = chartFromData(data, namer(data, names), familyId, new Set(names.keys()));
    content = data.entities.length ? (
      <Card title="Structure chart" description="Solid lines are shareholdings, with the share held. Dashed lines are settlors, founders and family entities acting as trustee or council. Select a box to open it." actions={<PrintButton />}>
        <StructureChart nodes={nodes} edges={edges} title={`Structure chart of the ${familyName}`} />
      </Card>
    ) : (
      <Notice>No entities yet, or none that you have access to.</Notice>
    );
  }

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="organisation"
      crumbs={[["My families", "/"], [familyName, `/families/${familyId}`], ["The Organisation", `/families/${familyId}/organisation`], ["Structure chart"]]}
      user={{ name: ctx.displayName, roleLabel: ctx.roleLabel, hasTwoFactor: ctx.hasTwoFactor }}
    >
      <PageTitle
        eyebrow="The Organisation"
        title="Structure chart"
        subtitle="Who owns which entity, drawn from the shareholdings, settlements and appointments recorded."
        actions={
          <Link href={`/families/${familyId}/organisation`} className="btn-quiet">
            Back to the Organisation
          </Link>
        }
      />
      {content}
    </AppShell>
  );
}
