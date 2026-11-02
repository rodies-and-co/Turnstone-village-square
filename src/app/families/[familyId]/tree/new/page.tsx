import { redirect } from "next/navigation";
import { AppShell, PageTitle } from "@/components/AppShell";
import { SubmitButton } from "@/components/feedback";
import { Alert, Card } from "@/components/ui";
import { PersonFields } from "../PersonFields";
import { createPerson } from "../actions";
import { getFamilyContext } from "@/lib/family-context";
import { errorMessage } from "@/lib/messages";

export const dynamic = "force-dynamic";

export default async function NewPersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { familyId } = await params;
  const { error } = await searchParams;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.canEdit || !ctx.db) redirect(`/families/${familyId}/tree`);

  const { data: branches } = await ctx.db
    .from("branches")
    .select("id, name")
    .order("name");

  const familyName = /family$/i.test(ctx.family.name.trim())
    ? ctx.family.name
    : `${ctx.family.name} family`;

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="tree"
      crumbs={[
        ["My families", "/"],
        [familyName, `/families/${familyId}`],
        ["The Tree", `/families/${familyId}/tree`],
        ["Add person"],
      ]}
      user={{
        name: ctx.displayName,
        roleLabel: ctx.roleLabel,
        hasTwoFactor: ctx.hasTwoFactor,
      }}
    >
      <PageTitle
        title="Add person"
        subtitle="Personal details, addresses and family links can be added after saving."
      />
      {error && (
        <div className="mb-4">
          <Alert>Not saved: {errorMessage(error)}</Alert>
        </div>
      )}
      <Card title="Details">
        <form action={createPerson.bind(null, familyId)} className="space-y-5">
          <PersonFields branches={branches ?? []} canChooseBranch />
          <SubmitButton pendingText="Adding…">Add person</SubmitButton>
        </form>
      </Card>
    </AppShell>
  );
}
