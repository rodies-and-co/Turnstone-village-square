import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageTitle } from "@/components/AppShell";
import { SubmitButton, Toast } from "@/components/feedback";
import { Card, Fold } from "@/components/ui";
import { getFamilyContext } from "@/lib/family-context";
import { formatDate } from "@/lib/governance";
import { errorMessage, savedMessage } from "@/lib/messages";
import { londonDate } from "@/lib/organising";
import { BANDS, IMPACT, LIKELIHOOD, band, describe, type Band } from "@/lib/risk";
import { TextArea } from "../meetings/DecisionsArea";
import { loadOrganising, loadTeam } from "../organising/organising-data";
import type { Suggestion } from "@/lib/risk-suggestions";
import { addRisk, askAgain, dismissSuggestion } from "./actions";
import { aboutText, categoryText, loadCategories, loadLook, loadRisks, type Category } from "./risk-data";
import { AddRiskForm, BandChip, DetailFields, HeatMap, RatingFields, RiskList, aboutValue } from "./RiskParts";

export const dynamic = "force-dynamic";

type View = "register" | "heatmap" | "suggestions";

// The family's one risk register (decision 1.2), its heat map (also under
// Reports, decision 2.8) and the risks the records suggest.
export default async function RisksPage({
  params,
  searchParams,
}: {
  params: Promise<{ familyId: string }>;
  searchParams: Promise<{ view?: string; category?: string; band?: string; status?: string; about?: string; saved?: string; error?: string }>;
}) {
  const { familyId } = await params;
  const sp = await searchParams;
  const ctx = await getFamilyContext(familyId);
  if (!ctx.db) notFound();
  const view: View = sp.view === "heatmap" ? "heatmap" : sp.view === "suggestions" && ctx.canEdit ? "suggestions" : "register";
  const [catList, look, risks, team] = await Promise.all([loadCategories(ctx), loadLook(ctx), loadRisks(ctx), loadTeam(ctx)]);
  const cats = new Map(catList.map((c) => [c.key, c]));
  const { suggestions, now } = ctx.canEdit ? await loadOrganising(ctx, look.names) : { suggestions: [], now: londonDate(new Date().toISOString())! };
  const { data: answerRows } = ctx.canEdit ? await ctx.db.from("risk_suggestion_answers").select("id, suggestion_key, reason, dismissed, answered_at").eq("dismissed", true).order("answered_at", { ascending: false }) : { data: [] };
  const dismissed = (answerRows ?? []) as { id: string; suggestion_key: string; reason: string; answered_at: string }[];
  const me = ctx.user?.id ?? "";
  const familyName = /family$/i.test(ctx.family.name.trim()) ? ctx.family.name : `${ctx.family.name} family`;
  const base = `/families/${familyId}/risks`;

  // Register filters.
  const status = sp.status === "closed" || sp.status === "all" ? sp.status : "open";
  const bandFilter = (["low", "medium", "high", "critical", "unrated"] as const).find((b) => b === sp.band);
  const listed = risks
    .filter((r) => status === "all" || r.status === status)
    .filter((r) => !sp.category || r.category === sp.category)
    .filter((r) => !sp.about || (sp.about === "family" ? !r.entity_id && !r.branch_id && !r.person_id : `${r.entity_id ? "entity" : r.branch_id ? "branch" : "person"}:${r.entity_id ?? r.branch_id ?? r.person_id}` === sp.about))
    .filter((r) => !bandFilter || (bandFilter === "unrated" ? !r.current : r.current && describe(r.current, "residual").band === bandFilter))
    .sort((a, b) => (b.current ? describe(b.current, "residual").score : -1) - (a.current ? describe(a.current, "residual").score : -1) || a.title.localeCompare(b.title));

  const open = risks.filter((r) => r.status === "open");
  const rated = open.filter((r) => r.current);
  const counts = (["critical", "high", "medium", "low"] as Band[]).map((b) => [b, rated.filter((r) => describe(r.current!, "residual").band === b).length] as const);
  const tabs: [View, string, string][] = [
    ["register", `Risk register (${open.length})`, base],
    ["heatmap", "Heat map", `${base}?view=heatmap`],
    ...(ctx.canEdit ? ([["suggestions", `Suggested (${suggestions.length})`, `${base}?view=suggestions`]] as [View, string, string][]) : []),
  ];

  return (
    <AppShell
      family={{ id: familyId, name: ctx.family.name }}
      section={view === "heatmap" ? "heatmap" : "risks"}
      crumbs={[["My families", "/"], [familyName, `/families/${familyId}`], ["Risk management"]]}
      user={{ name: ctx.displayName, roleLabel: ctx.roleLabel, hasTwoFactor: ctx.hasTwoFactor }}
    >
      {sp.error && <Toast key={`e-${sp.error}-${Date.now()}`} kind="error" message={errorMessage(sp.error)!} />}
      {sp.saved && !sp.error && <Toast key={`s-${sp.saved}-${Date.now()}`} message={savedMessage(sp.saved)!} />}
      <PageTitle
        title="Risk management"
        subtitle="The family's one risk register. Each risk is rated before and after controls; a rating counts once a Manager who didn't prepare it approves it."
      />
      <nav aria-label="Risk management" className="border-b border-border">
        <ul className="flex flex-wrap gap-x-1">
          {tabs.map(([k, t, href]) => (
            <li key={k}>
              <Link
                href={href}
                aria-current={view === k ? "page" : undefined}
                className={`inline-flex min-h-11 items-center border-b-2 px-3 text-[15px] ${view === k ? "border-primary font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
              >
                {t}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-6 space-y-5">
        {sp.error && <p className="alert">Not saved: {errorMessage(sp.error)}</p>}

        {view === "register" && (
          <>
            <div className="flex flex-wrap gap-2" aria-label="Open risks after controls">
              {counts.map(([b, n]) => (
                <Link key={b} href={`${base}?band=${b}`} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border bg-card px-3 text-sm text-ink hover:underline">
                  <span className="font-semibold">{n}</span> {BANDS[b].toLowerCase()}
                </Link>
              ))}
              <Link href={`${base}?band=unrated`} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border bg-card px-3 text-sm text-ink hover:underline">
                <span className="font-semibold">{open.length - rated.length}</span> not rated yet
              </Link>
            </div>
            {ctx.canEdit && (
              <Card title="Add a risk" description="Anything that could harm the family's people, relationships, wealth or purpose.">
                <Fold label="Add a risk">
                  <AddRiskForm familyId={familyId} back={base} cats={catList} look={look} team={team} me={me} />
                </Fold>
              </Card>
            )}
            <Card title="The register">
              <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
                <div>
                  <label htmlFor="f-category" className="mb-1 block text-sm font-medium text-ink">
                    Category
                  </label>
                  <select id="f-category" name="category" defaultValue={sp.category ?? ""} className="text-input">
                    <option value="">All</option>
                    {catList.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="f-about" className="mb-1 block text-sm font-medium text-ink">
                    About
                  </label>
                  <select id="f-about" name="about" defaultValue={sp.about ?? ""} className="text-input">
                    <option value="">Anything</option>
                    <option value="family">The whole family</option>
                    {[...look.entities.entries()].map(([id, n]) => (
                      <option key={id} value={`entity:${id}`}>
                        {n}
                      </option>
                    ))}
                    {[...look.branches.entries()].map(([id, n]) => (
                      <option key={id} value={`branch:${id}`}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="f-band" className="mb-1 block text-sm font-medium text-ink">
                    After controls
                  </label>
                  <select id="f-band" name="band" defaultValue={bandFilter ?? ""} className="text-input">
                    <option value="">Any rating</option>
                    {(["critical", "high", "medium", "low"] as Band[]).map((b) => (
                      <option key={b} value={b}>
                        {BANDS[b]}
                      </option>
                    ))}
                    <option value="unrated">Not rated yet</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="f-status" className="mb-1 block text-sm font-medium text-ink">
                    Show
                  </label>
                  <select id="f-status" name="status" defaultValue={status} className="text-input">
                    <option value="open">Open risks</option>
                    <option value="closed">Closed risks</option>
                    <option value="all">All</option>
                  </select>
                </div>
                <button type="submit" className="btn-secondary">
                  Show
                </button>
              </form>
              <RiskList risks={listed} familyId={familyId} cats={cats} look={look} team={team} now={now} />
            </Card>
          </>
        )}

        {view === "heatmap" && (
          <>
            <Card title="Heat map" description={`${rated.length} open ${rated.length === 1 ? "risk" : "risks"} with an approved rating. Risks not rated yet, or waiting for approval of their first rating, aren't shown.`}>
              <div className="grid gap-8 lg:grid-cols-2">
                <HeatMap ratings={rated.map((r) => r.current!)} which="inherent" title="Before controls (inherent)" />
                <HeatMap ratings={rated.map((r) => r.current!)} which="residual" title="After controls (residual)" />
              </div>
              <p className="mt-4 text-sm text-ink-2">
                Score = likelihood × impact. Low 1–4, medium 5–9, high 10–16, critical 20–25.
              </p>
            </Card>
            <Card title="Highest risks after controls">
              {rated.length === 0 ? (
                <p className="text-ink-3">No rated risks yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-ink">
                        <th scope="col" className="py-2 pr-3 font-semibold">Risk</th>
                        <th scope="col" className="py-2 pr-3 font-semibold">About</th>
                        <th scope="col" className="py-2 pr-3 font-semibold">Before controls</th>
                        <th scope="col" className="py-2 pr-3 font-semibold">After controls</th>
                        <th scope="col" className="py-2 font-semibold">Rated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...rated]
                        .sort((a, b) => describe(b.current!, "residual").score - describe(a.current!, "residual").score)
                        .map((r) => {
                          const i = describe(r.current!, "inherent");
                          const d = describe(r.current!, "residual");
                          return (
                            <tr key={r.id} className="border-b border-border align-top">
                              <td className="py-2 pr-3">
                                <Link href={`${base}/${r.id}`} className="font-medium text-ink hover:underline">
                                  {r.title}
                                </Link>
                                <span className="block text-ink-3">{categoryText(cats, r.category, r.subcategory)}</span>
                              </td>
                              <td className="py-2 pr-3">{aboutText(r, look)}</td>
                              <td className="py-2 pr-3">
                                <BandChip band={i.band} score={i.score} />
                                <span className="block text-xs text-ink-3">
                                  {LIKELIHOOD[i.likelihood]}, {IMPACT[i.impact].toLowerCase()}
                                </span>
                              </td>
                              <td className="py-2 pr-3">
                                <BandChip band={d.band} score={d.score} />
                                <span className="block text-xs text-ink-3">
                                  {LIKELIHOOD[d.likelihood]}, {IMPACT[d.impact].toLowerCase()}
                                </span>
                              </td>
                              <td className="py-2">{formatDate(r.current!.reviewed_on)}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}

        {view === "suggestions" && (
          <>
            <Card
              title="Suggested risks"
              description="Worked out from what is recorded. Add each to the register (you can change it first), or dismiss it with a reason. Nothing is added by itself."
            >
              {suggestions.length === 0 ? (
                <p className="text-ink-3">No suggestions right now.</p>
              ) : (
                <ul className="divide-y divide-border border-y border-border">
                  {suggestions.map((s) => {
                    const d = describe(s.rating, "residual");
                    return (
                      <li key={s.key} className="space-y-2 py-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[15px] font-medium text-ink">{s.title}</p>
                            <p className="text-sm text-ink-3">
                              {categoryText(cats, s.category, s.subcategory)} · {aboutText({ entity_id: s.entityId ?? null, branch_id: null, person_id: s.personId ?? null }, look)}
                            </p>
                            <p className="text-sm text-ink-2">{s.why}</p>
                          </div>
                          <BandChip band={band(d.score)} score={d.score} prefix="Suggested:" />
                        </div>
                        <div className="flex flex-wrap items-start gap-4">
                          <Fold label="Add to the register">
                            <SuggestionForm familyId={familyId} s={s} cats={catList} look={look} team={team} me={me} />
                          </Fold>
                          <Fold label="Dismiss">
                            <form action={dismissSuggestion.bind(null, familyId, s.key)} className="space-y-3">
                              <TextArea id={`dismiss-${s.key}`} label="Why it doesn't need to go in the register (required)" name="reason" rows={2} />
                              <SubmitButton variant="secondary">Dismiss</SubmitButton>
                            </form>
                          </Fold>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
            {dismissed.length > 0 && (
              <Card title="Dismissed">
                <Fold label={`Show dismissed suggestions (${dismissed.length})`}>
                  <ul className="divide-y divide-border border-y border-border">
                    {dismissed.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                        <div>
                          <p className="text-sm text-ink">{a.reason}</p>
                          <p className="text-xs text-ink-3">Dismissed {formatDate(londonDate(a.answered_at))}</p>
                        </div>
                        {ctx.canManage && (
                          <form action={askAgain.bind(null, familyId, a.id)}>
                            <SubmitButton variant="quiet" pendingText="Saving…">
                              Ask again
                            </SubmitButton>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                </Fold>
              </Card>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

// Accepting a suggestion: the add form, filled in from it.
function SuggestionForm({ familyId, s, cats, look, team, me }: { familyId: string; s: Suggestion; cats: Category[]; look: { entities: Map<string, string>; branches: Map<string, string>; names: Map<string, string> }; team: Map<string, string>; me: string }) {
  const r = { title: s.title, description: s.why, category: s.category, subcategory: s.subcategory, entity_id: s.entityId ?? null, branch_id: null, person_id: s.personId ?? null };
  return (
    <form action={addRisk.bind(null, familyId, `/families/${familyId}/risks?view=suggestions`)} className="space-y-4">
      <input type="hidden" name="suggestion_key" value={s.key} />
      <DetailFields cats={cats} look={look} team={team} me={me} r={{ ...r, owner_id: me }} prefix={`s-${s.key}`} fixedAbout={aboutValue(r)} />
      <RatingFields prefix={`s-${s.key}`} r={s.rating} />
      <SubmitButton>Add to the register</SubmitButton>
    </form>
  );
}
