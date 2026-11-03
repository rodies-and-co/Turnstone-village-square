import Link from "next/link";
import { Card, Fold } from "@/components/ui";
import type { FamilyContext } from "@/lib/family-context";
import { londonDate } from "@/lib/organising";
import { loadTeam } from "../organising/organising-data";
import { loadCategories, loadLook, loadRisks } from "./risk-data";
import { AddRiskForm, RiskList } from "./RiskParts";

// One entity's or person's view of the family's one risk register
// (decision 1.2): the risks about it, and adding one.
export async function RiskFor({ ctx, familyId, entityId, personId, here }: { ctx: FamilyContext; familyId: string; entityId?: string; personId?: string; here: string }) {
  const [catList, look, risks, team] = await Promise.all([loadCategories(ctx), loadLook(ctx), loadRisks(ctx, { entityId, personId }), loadTeam(ctx)]);
  const cats = new Map(catList.map((c) => [c.key, c]));
  const now = londonDate(new Date().toISOString())!;
  const open = risks.filter((r) => r.status === "open");
  const closed = risks.filter((r) => r.status === "closed");
  return (
    <div className="space-y-5">
      <Card
        title={personId ? "Risk notes" : "Risks"}
        description={
          personId
            ? "Risks about this person, from the family's risk register. Only Managers and Administrators see them."
            : "Risks about this entity, from the family's risk register."
        }
        actions={
          <Link href={`/families/${familyId}/risks`} className="btn-secondary">
            The whole register
          </Link>
        }
      >
        <RiskList risks={open} familyId={familyId} cats={cats} look={look} team={team} now={now} hideAbout />
        {closed.length > 0 && (
          <Fold label={`Closed (${closed.length})`}>
            <RiskList risks={closed} familyId={familyId} cats={cats} look={look} team={team} now={now} hideAbout />
          </Fold>
        )}
      </Card>
      {ctx.canEdit && (
        <Card title="Add a risk">
          <Fold label="Add a risk">
            <AddRiskForm familyId={familyId} back={here} cats={catList} look={look} team={team} me={ctx.user?.id ?? ""} fixedAbout={entityId ? `entity:${entityId}` : `person:${personId}`} />
          </Fold>
        </Card>
      )}
    </div>
  );
}
