import { redirect } from "next/navigation";
import { AppShell, PageTitle } from "@/components/AppShell";
import { SubmitButton, Toast } from "@/components/feedback";
import { Card } from "@/components/ui";
import { getFamilyContext } from "@/lib/family-context";
import { errorMessage } from "@/lib/messages";
import { displayNames, type PersonSummary } from "@/lib/people";
import { EntityFields } from "../EntityFields";
import { createEntity } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewEntityPage({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { familyId } = await params;
  const { error } = await searchParams;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.canEdit || !ctx.db) redirect(`/families/${familyId}/organisation`);
  const familyName = /family$/i.test(ctx.family.name.trim())
    ? ctx.family.name
    : `${ctx.family.name} family`;

  const [
    { data: standards },
    { data: people },
    { data: branches },
    { data: providers },
    { data: entities },
  ] = await Promise.all([
    ctx.supabase
      .from("entity_standards")
      .select(
        "jurisdiction, entity_type, sub_type, status, version, registered_agent_required, management_company_required, licensed_trustee_required",
      ),
    ctx.db
      .from("people")
      .select("id, full_names, surname, known_as, birth_year, member_type")
      .order("surname"),
    ctx.db.from("branches").select("id, name").order("name"),
    ctx.db
      .from("outside_organisations")
      .select("id, name, licensed")
      .order("name"),
    ctx.db.from("entities").select("id, name").order("name"),
  ]);
  const names = displayNames((people ?? []) as PersonSummary[]);

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="organisation"
      crumbs={[
        ["My families", "/"],
        [familyName, `/families/${familyId}`],
        ["The Organisation", `/families/${familyId}/organisation`],
        ["Add entity"],
      ]}
      user={{
        name: ctx.displayName,
        roleLabel: ctx.roleLabel,
        hasTwoFactor: ctx.hasTwoFactor,
      }}
    >
      {error && (
        <Toast key={`e-${error}`} kind="error" message={errorMessage(error)!} />
      )}
      <PageTitle
        title="Add entity"
        subtitle="Choose the jurisdiction and type first: they decide the Entity Standard, which sets the officers, registers and filings it needs."
      />
      {error && <p className="alert mb-5">Not saved: {errorMessage(error)}</p>}
      <Card title="Details">
        <form action={createEntity.bind(null, familyId)} className="space-y-6">
          <EntityFields
            standards={standards ?? []}
            people={(people ?? [])
              .map(
                (p: { id: string }) =>
                  [p.id, names.get(p.id) ?? ""] as [string, string],
              )
              .sort((a, b) => a[1].localeCompare(b[1]))}
            branches={(branches ?? []).map(
              (b: { id: string; name: string }) =>
                [b.id, b.name] as [string, string],
            )}
            providers={(
              (providers ?? []) as {
                id: string;
                name: string;
                licensed: boolean;
              }[]
            ).map(
              (o) => [o.id, o.name, o.licensed] as [string, string, boolean],
            )}
            familyEntities={(
              (entities ?? []) as { id: string; name: string }[]
            ).map((e) => [e.id, e.name] as [string, string])}
          />
          <p className="text-sm text-ink-3">
            The registered office and the other officers are added after saving.
          </p>
          <SubmitButton pendingText="Adding…">Add entity</SubmitButton>
        </form>
      </Card>
    </AppShell>
  );
}
