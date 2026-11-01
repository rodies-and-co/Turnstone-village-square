import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { Alert, BackLink, Card, PageShell } from "@/components/ui";
import { PersonFields } from "../PersonFields";
import { createPerson } from "../actions";
import { getFamilyContext } from "@/lib/family-context";

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

  const { data: branches } = await ctx.db.from("branches").select("id, name").order("name");

  return (
    <>
      <SiteHeader name={ctx.displayName} roleLabel={ctx.roleLabel} hasTwoFactor={ctx.hasTwoFactor} />
      <PageShell>
        <BackLink href={`/families/${familyId}/tree`}>The Tree</BackLink>
        <h1 className="mt-2 text-2xl font-semibold text-ink">Add a person</h1>
        {error && (
          <div className="mt-4">
            <Alert>{error}</Alert>
          </div>
        )}
        <div className="mt-6">
          <Card>
            <form action={createPerson.bind(null, familyId)} className="space-y-5">
              <PersonFields branches={branches ?? []} canChooseBranch />
              <p className="text-sm text-ink">
                You can add personal details, addresses and family links after saving.
              </p>
              <button type="submit" className="btn-primary">
                Save person
              </button>
            </form>
          </Card>
        </div>
      </PageShell>
    </>
  );
}
