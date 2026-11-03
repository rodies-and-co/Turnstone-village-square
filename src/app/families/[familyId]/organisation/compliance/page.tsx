import Link from "next/link";
import { AppShell, PageTitle } from "@/components/AppShell";
import { Toast } from "@/components/feedback";
import { Notice } from "@/components/ui";
import { getFamilyContext } from "@/lib/family-context";
import { errorMessage, savedMessage } from "@/lib/messages";
import { displayNames, type PersonSummary } from "@/lib/people";
import { ComplianceList } from "../ComplianceList";
import { loadCalendars, namer } from "../compliance-data";
import { loadOrganisationData } from "../organisation-data";

export const dynamic = "force-dynamic";

// The family's compliance calendar: every entity's filings and notices.
export default async function CompliancePage({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { familyId } = await params;
  const sp = await searchParams;
  const ctx = await getFamilyContext(familyId);
  const familyName = /family$/i.test(ctx.family.name.trim())
    ? ctx.family.name
    : `${ctx.family.name} family`;

  let content = (
    <Notice>This family&apos;s database isn&apos;t connected yet.</Notice>
  );
  if (ctx.db) {
    const data = await loadOrganisationData(ctx);
    const { data: people } = await ctx.db
      .from("people")
      .select("id, full_names, surname, known_as, birth_year");
    const calendars = await loadCalendars(
      ctx,
      data,
      namer(data, displayNames((people ?? []) as PersonSummary[])),
    );
    content = data.entities.length ? (
      <ComplianceList
        calendars={calendars}
        familyId={familyId}
        canEdit={ctx.canEdit}
        back={`/families/${familyId}/organisation/compliance`}
        showEntity
      />
    ) : (
      <Notice>No entities yet, or none that you have access to.</Notice>
    );
  }

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="compliance"
      crumbs={[
        ["My families", "/"],
        [familyName, `/families/${familyId}`],
        ["The Organisation", `/families/${familyId}/organisation`],
        ["Compliance calendar"],
      ]}
      user={{
        name: ctx.displayName,
        roleLabel: ctx.roleLabel,
        hasTwoFactor: ctx.hasTwoFactor,
      }}
    >
      {sp.error && (
        <Toast
          key={`e-${sp.error}-${Date.now()}`}
          kind="error"
          message={errorMessage(sp.error)!}
        />
      )}
      {sp.saved && !sp.error && (
        <Toast
          key={`s-${sp.saved}-${Date.now()}`}
          message={savedMessage(sp.saved)!}
        />
      )}
      <PageTitle
        eyebrow="The Organisation"
        title="Compliance calendar"
        subtitle="Every entity's filings, fees and notices, worked out from its Entity Standard and what is recorded. Check the dates before relying on them: this is a checklist, not legal advice."
        actions={
          <Link
            href={`/families/${familyId}/organisation`}
            className="btn-quiet"
          >
            Back to the Organisation
          </Link>
        }
      />
      <div className="space-y-5">
        {sp.error && (
          <p className="alert">Not saved: {errorMessage(sp.error)}</p>
        )}
        {content}
      </div>
    </AppShell>
  );
}
