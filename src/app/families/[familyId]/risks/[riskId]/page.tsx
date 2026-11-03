import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageTitle } from "@/components/AppShell";
import { ConfirmRemove, SubmitButton, Toast } from "@/components/feedback";
import { Card, Facts, Field, Fold } from "@/components/ui";
import { getFamilyContext } from "@/lib/family-context";
import { formatDate } from "@/lib/governance";
import { errorMessage, savedMessage } from "@/lib/messages";
import { londonDate } from "@/lib/organising";
import { RESPONSES, describe } from "@/lib/risk";
import { TextArea } from "../../meetings/DecisionsArea";
import { loadTeam } from "../../organising/organising-data";
import { addRating, approveRating, closeRisk, removeRating, removeRisk, reopenRisk, updateRating, updateRisk } from "../actions";
import { aboutText, categoryText, loadCategories, loadLook, loadRisks, type Review } from "../risk-data";
import { BandChip, DetailFields, RatingFields } from "../RiskParts";

export const dynamic = "force-dynamic";

function RatingSummary({ v }: { v: Review }) {
  const i = describe(v, "inherent");
  const r = describe(v, "residual");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <BandChip band={i.band} score={i.score} prefix="Before controls:" />
        <span aria-hidden="true" className="text-ink-3">→</span>
        <BandChip band={r.band} score={r.score} prefix="After controls:" />
      </div>
      <p className="text-sm text-ink-2">
        Before: {i.text.split(": ")[1]}. After: {r.text.split(": ")[1]}.
      </p>
      {v.controls && <p className="whitespace-pre-wrap text-sm text-ink"><span className="font-medium">Controls:</span> {v.controls}</p>}
      {v.notes && <p className="whitespace-pre-wrap text-sm text-ink-2">{v.notes}</p>}
    </div>
  );
}

export default async function RiskPage({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string; riskId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { familyId, riskId } = await params;
  const sp = await searchParams;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db) notFound();
  const [catList, look, [risk], team] = await Promise.all([loadCategories(ctx), loadLook(ctx), loadRisks(ctx, { riskId }), loadTeam(ctx)]);
  if (!risk) notFound();
  const cats = new Map(catList.map((c) => [c.key, c]));
  const me = ctx.user?.id ?? "";
  const now = londonDate(new Date().toISOString())!;
  const familyName = /family$/i.test(ctx.family.name.trim()) ? ctx.family.name : `${ctx.family.name} family`;
  const who = (id: string | null) => (id ? (team.get(id) ?? "a team member") : "the setup");
  const history = risk.reviews.filter((v) => v.status === "approved");
  const canApprove = ctx.canManage && risk.draft && risk.draft.prepared_by !== me && !(risk.draft.changed_by ?? []).includes(me);

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section="risks"
      crumbs={[["My families", "/"], [familyName, `/families/${familyId}`], ["Risk management", `/families/${familyId}/risks`], [risk.title]]}
      user={{ name: ctx.displayName, roleLabel: ctx.roleLabel, hasTwoFactor: ctx.hasTwoFactor }}
    >
      {sp.error && <Toast key={`e-${sp.error}-${Date.now()}`} kind="error" message={errorMessage(sp.error)!} />}
      {sp.saved && !sp.error && <Toast key={`s-${sp.saved}-${Date.now()}`} message={savedMessage(sp.saved)!} />}
      <PageTitle title={risk.title} subtitle={`${categoryText(cats, risk.category, risk.subcategory)} · ${aboutText(risk, look)}${risk.status === "closed" ? ` · Closed ${formatDate(risk.closed_on)}` : ""}`} />
      <div className="mt-6 space-y-5">
        {sp.error && <p className="alert">Not saved: {errorMessage(sp.error)}</p>}

        <Card title="Rating">
          {risk.current ? (
            <>
              <RatingSummary v={risk.current} />
              <p className="mt-2 text-xs text-ink-3">
                Rated {formatDate(risk.current.reviewed_on)} by {who(risk.current.prepared_by)}; approved by {who(risk.current.approved_by)}.
              </p>
            </>
          ) : (
            <p className="text-ink-3">No approved rating yet, so this risk isn&apos;t on the heat map.</p>
          )}
        </Card>

        {risk.draft && (
          <Card
            title="New rating waiting for approval"
            description={`Prepared by ${who(risk.draft.prepared_by)}${risk.draft.changed_by?.length ? `, changed by ${risk.draft.changed_by.map(who).join(", ")}` : ""}. A Manager who didn't prepare or change it approves it.`}
          >
            <RatingSummary v={risk.draft} />
            {ctx.canEdit && (
              <div className="mt-4 flex flex-wrap items-start gap-3">
                {canApprove && (
                  <form action={approveRating.bind(null, familyId, risk.id, risk.draft.id)}>
                    <SubmitButton pendingText="Approving…">Approve this rating</SubmitButton>
                  </form>
                )}
                {ctx.canManage && !canApprove && <p className="text-sm text-ink-3">You prepared or changed this rating, so another Manager approves it.</p>}
                <Fold label="Change">
                  <form action={updateRating.bind(null, familyId, risk.id, risk.draft.id)} className="space-y-4">
                    <RatingFields prefix="draft" r={risk.draft} />
                    <SubmitButton>Save</SubmitButton>
                  </form>
                </Fold>
                <ConfirmRemove action={removeRating.bind(null, familyId, risk.id, risk.draft.id)} what="this draft rating" />
              </div>
            )}
          </Card>
        )}

        {ctx.canEdit && risk.status === "open" && !risk.draft && (
          <Card title={risk.current ? "Rate it again" : "Rate this risk"} description={risk.current ? "At each review, rate it again (the same, if nothing has changed). The new rating counts once another Manager approves it." : undefined}>
            <Fold label={risk.current ? "Rate it again" : "Rate it"} open={!risk.current}>
              <form action={addRating.bind(null, familyId, risk.id)} className="space-y-4">
                <RatingFields prefix="again" r={risk.current ? { ...risk.current, reviewed_on: "", notes: null } : null} />
                <SubmitButton>Save the rating</SubmitButton>
              </form>
            </Fold>
          </Card>
        )}

        <Card title="Details">
          <Facts
            items={[
              ["What could happen", risk.description],
              ["How it is handled", RESPONSES[risk.response]],
              ["Owner", risk.owner_id ? (team.get(risk.owner_id) ?? "A team member") : "Nobody yet"],
              ["Next review", risk.status === "closed" ? "Closed" : risk.next_review_on ? `${formatDate(risk.next_review_on)}${risk.next_review_on < now ? " (overdue)" : ""}` : "Not set"],
              ...(risk.status === "closed" ? ([["Why it was closed", risk.closed_reason]] as [string, string | null][]) : []),
              ...(risk.suggestion_key ? ([["Where it came from", "A suggestion worked out from the records"]] as [string, string][]) : []),
            ]}
          />
          {ctx.canEdit && (
            <div className="mt-4 flex flex-wrap items-start gap-4">
              <Fold label="Change the details">
                <form action={updateRisk.bind(null, familyId, risk.id)} className="space-y-4">
                  <DetailFields cats={catList} look={look} team={team} me={me} r={risk} prefix="edit" canChangeAbout={ctx.canManage} />
                  <SubmitButton>Save</SubmitButton>
                </form>
              </Fold>
              {ctx.canManage &&
                (risk.status === "open" ? (
                  <Fold label="Close this risk">
                    <form action={closeRisk.bind(null, familyId, risk.id)} className="space-y-4">
                      <Field id="closed-on" label="Closed on" name="closed_on" type="date" required defaultValue={now} />
                      <TextArea id="closed-reason" label="Why (required)" name="closed_reason" rows={2} hint="E.g. the activity has stopped, or the risk no longer applies. It stays in the register's history." />
                      <SubmitButton variant="secondary">Close the risk</SubmitButton>
                    </form>
                  </Fold>
                ) : (
                  <form action={reopenRisk.bind(null, familyId, risk.id)}>
                    <SubmitButton variant="secondary" pendingText="Saving…">
                      Reopen this risk
                    </SubmitButton>
                  </form>
                ))}
              {!risk.current && <ConfirmRemove action={removeRisk.bind(null, familyId, risk.id)} what={`the risk "${risk.title}"`} />}
            </div>
          )}
        </Card>

        <Card title="Rating history" description="Every approved rating is kept.">
          {history.length === 0 ? (
            <p className="text-ink-3">None yet.</p>
          ) : (
            <ul className="divide-y divide-border border-y border-border">
              {history.map((v) => (
                <li key={v.id} className="space-y-1 py-3">
                  <p className="text-sm text-ink-3">
                    {formatDate(v.reviewed_on)} · rated by {who(v.prepared_by)}, approved by {who(v.approved_by)}
                  </p>
                  <RatingSummary v={v} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <p>
          <Link href={`/families/${familyId}/risks`} className="text-ink underline">
            Back to the risk register
          </Link>
        </p>
      </div>
    </AppShell>
  );
}
