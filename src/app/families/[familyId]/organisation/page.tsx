import Link from "next/link";
import { AppShell, PageTitle } from "@/components/AppShell";
import { Toast } from "@/components/feedback";
import { Card, Chip } from "@/components/ui";
import { matchStandard, type EntityType } from "@/lib/entity-checklist";
import { getFamilyContext } from "@/lib/family-context";
import { errorMessage, savedMessage } from "@/lib/messages";
import { STATUS_LABELS } from "@/lib/standards";

export const dynamic = "force-dynamic";

type Entity = {
  id: string;
  name: string;
  entity_type: EntityType;
  jurisdiction: string;
  sub_type: string;
  standard_id: string | null;
  registration_number: string | null;
  status: string;
  branch_id: string | null;
};

const GROUPS: [EntityType, string][] = [
  ["company", "Companies"],
  ["trust", "Trusts"],
  ["foundation", "Foundations"],
  ["llc", "LLCs"],
  ["partnership", "Partnerships"],
];

export default async function OrganisationPage({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { familyId } = await params;
  const sp = await searchParams;
  const ctx = await getFamilyContext(familyId);
  const familyName = /family$/i.test(ctx.family.name.trim()) ? ctx.family.name : `${ctx.family.name} family`;

  let entities: Entity[] = [];
  let branches = new Map<string, string>();
  let allStandards: { id: string; status: keyof typeof STATUS_LABELS; jurisdiction: string; entity_type: string; sub_type: string; version: number }[] = [];
  let standards = new Map<string, { status: keyof typeof STATUS_LABELS }>();
  if (ctx.db) {
    const [e, b, s] = await Promise.all([
      ctx.db.from("entities").select("id, name, entity_type, jurisdiction, sub_type, standard_id, registration_number, status, branch_id").order("name"),
      ctx.db.from("branches").select("id, name"),
      ctx.supabase.from("entity_standards").select("id, status, jurisdiction, entity_type, sub_type, version"),
    ]);
    entities = (e.data ?? []) as Entity[];
    branches = new Map((b.data ?? []).map((x: { id: string; name: string }) => [x.id, x.name]));
    allStandards = (s.data ?? []) as typeof allStandards;
    standards = new Map(allStandards.map((x) => [x.id, x]));
  }

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="organisation"
      crumbs={[["My families", "/"], [familyName, `/families/${familyId}`], ["The Organisation"]]}
      user={{ name: ctx.displayName, roleLabel: ctx.roleLabel, hasTwoFactor: ctx.hasTwoFactor }}
    >
      {sp.error && <Toast key={`e-${sp.error}-${Date.now()}`} kind="error" message={errorMessage(sp.error)!} />}
      {sp.saved && !sp.error && <Toast key={`s-${sp.saved}-${Date.now()}`} message={savedMessage(sp.saved)!} />}
      <PageTitle
        eyebrow="Recording the facts"
        title="The Organisation"
        subtitle="The family's companies, trusts and foundations. Each follows the Entity Standard for its jurisdiction and type."
        actions={
          ctx.canEdit && (
            <Link href={`/families/${familyId}/organisation/new`} className="btn-primary">
              Add entity
            </Link>
          )
        }
      />
      <div className="space-y-5">
        {entities.length === 0 && (
          <Card title="No entities yet">
            <p className="text-ink-2">
              {ctx.canEdit ? "Add the family's first company, trust or foundation." : "None that you have access to."}
            </p>
          </Card>
        )}
        {GROUPS.map(([type, title]) => {
          const rows = entities.filter((e) => e.entity_type === type);
          if (!rows.length) return null;
          return (
            <Card key={type} title={`${title} (${rows.length})`}>
              <ul className="divide-y divide-border border-t border-border">
                {rows.map((e) => {
                  const st = e.standard_id ? standards.get(e.standard_id) : (matchStandard(allStandards, e) ?? undefined);
                  return (
                    <li key={e.id}>
                      <Link
                        href={`/families/${familyId}/organisation/${e.id}`}
                        className="-mx-2 grid min-h-16 gap-x-6 gap-y-1 rounded-md px-2 py-3 hover:bg-muted md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.8fr)] md:items-center"
                      >
                        <span>
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-[15px] font-medium text-ink">{e.name}</span>
                            {e.status !== "active" && <Chip>{e.status === "dormant" ? "Dormant" : "Dissolved"}</Chip>}
                          </span>
                          <span className="block text-sm text-ink-3">
                            {e.jurisdiction} · {e.sub_type}
                          </span>
                        </span>
                        <span className="text-sm text-ink-2">{e.branch_id ? branches.get(e.branch_id) : "Whole family"}</span>
                        <span className="text-sm text-ink-2">
                          {st?.status === "approved" ? "Standard approved" : st ? STATUS_LABELS[st.status] : "No Entity Standard"}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}
