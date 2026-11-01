import Link from "next/link";
import { AppShell, PageTitle } from "@/components/AppShell";
import { Card, Chip } from "@/components/ui";
import { requireSignedIn } from "@/lib/auth";
import { ENTITY_TYPES, type EntityType } from "@/lib/entity-checklist";
import { SYSTEM_ROLE_LABELS } from "@/lib/roles";
import { STATUS_LABELS, type EntityStandard } from "@/lib/standards";

export const dynamic = "force-dynamic";

// Every Entity Standard, by jurisdiction. Drafts needing review come first.
export default async function StandardsPage() {
  const { supabase, systemRole, displayName, hasTwoFactor } = await requireSignedIn();
  const { data } = await supabase.from("entity_standards").select("id, jurisdiction, entity_type, sub_type, name, status, version, to_confirm").order("jurisdiction").order("entity_type").order("sub_type");
  const all = (data ?? []) as Pick<EntityStandard, "id" | "jurisdiction" | "entity_type" | "sub_type" | "name" | "status" | "version" | "to_confirm">[];
  const drafts = all.filter((s) => s.status === "draft");
  const jurisdictions = [...new Set(all.map((s) => s.jurisdiction))];
  const canApprove = systemRole === "super_user" || systemRole === "system_admin";

  const row = (s: (typeof all)[number]) => (
    <li key={s.id}>
      <Link href={`/standards/${s.id}`} className="-mx-2 flex min-h-14 flex-wrap items-center justify-between gap-2 rounded-md px-2 py-3 hover:bg-muted">
        <span>
          <span className="block text-[15px] font-medium text-ink">{s.sub_type}</span>
          <span className="block text-sm text-ink-3">
            {ENTITY_TYPES[s.entity_type as EntityType]} · version {s.version}
            {s.to_confirm ? " · has items to confirm" : ""}
          </span>
        </span>
        {s.status !== "approved" && <Chip>{STATUS_LABELS[s.status]}</Chip>}
      </Link>
    </li>
  );

  return (
    <AppShell section="standards" crumbs={[["My families", "/"], ["Entity Standards"]]} user={{ name: displayName, roleLabel: systemRole ? SYSTEM_ROLE_LABELS[systemRole] : null, hasTwoFactor }}>
      <PageTitle
        eyebrow="Shared by every family"
        title="Entity Standards"
        subtitle="The statutory rules for each kind of entity in each jurisdiction. They drive every entity's setup checklist. This is a compliance checklist, not legal advice."
      />
      <div className="space-y-5">
        {drafts.length > 0 && (
          <Card
            title={`Needs review (${drafts.length})`}
            description={canApprove ? "Check the rules and sources, then approve. Entities using a draft show an amber note until it is approved." : "The Super User or System Admin reviews these."}
          >
            <ul className="divide-y divide-border border-t border-border">{drafts.map(row)}</ul>
          </Card>
        )}
        {jurisdictions.map((j) => (
          <Card key={j} title={j}>
            <ul className="divide-y divide-border border-t border-border">{all.filter((s) => s.jurisdiction === j).map(row)}</ul>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
